#![no_std]
//! # Work Escrow
//!
//! A milestone escrow contract for client↔worker engagements paid in a SEP-41
//! token on Stellar.
//!
//! ## Trust model
//!
//! The contract has **no admin, no owner, no pause switch and no upgrade
//! path**. Once deployed its behaviour is fixed. This is a deliberate choice:
//! every escrow "admin" that exists is a key that can eventually be stolen or
//! coerced, and an escrow contract that custodies user funds should not have
//! one. Funds can only move along the deterministic paths below.
//!
//! ## Who can move funds
//!
//! | Action                    | Authorised party                         |
//! | ------------------------- | ---------------------------------------- |
//! | `create_job`              | The client (must sign)                   |
//! | `fund_job`                | The client (must sign)                   |
//! | `accept_job`              | The pre-assigned worker, or any worker    |
//! | `submit_milestone`        | The assigned worker only                 |
//! | `approve_milestone`       | The client only                          |
//! | `open_dispute`            | Client or worker                         |
//! | `propose_settlement`      | Client or worker                         |
//! | `accept_settlement`       | The counterparty of the proposer only    |
//! | `cancel_job`              | The client, before a worker accepts      |
//! | `expire_job`              | **Anyone** — payouts are deterministic    |
//!
//! A worker can never release client funds to itself; a client can never
//! redirect a submitted milestone's escrow to itself (only to the worker, or to
//! itself via a settlement the worker agreed to); and the only way to reach a
//! split of the escrow is a settlement accepted by *both* parties.
//!
//! ## What this contract does not do
//!
//! It does not judge the quality of submitted work. Proof is stored as a
//! SHA-256 commitment (see [`Milestone::proof_hash`]) and never evaluated on
//! chain. Quality disputes are resolved by mutual settlement or by the deadline
//! rules — see `docs/ESCROW.md` for the full discussion and the honest
//! limitations list.

mod error;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

pub use crate::error::Error;
pub use crate::types::{
    Job, JobStatus, Milestone, MilestoneInput, MilestoneStatus, Settlement, MAX_MILESTONES,
    MAX_PAGE_SIZE, MAX_REASON_LEN, MAX_TITLE_LEN,
};

use soroban_sdk::{contract, contractimpl, token::TokenClient, Address, BytesN, Env, String, Vec};

use crate::storage as store;

#[contract]
pub struct WorkEscrow;

#[contractimpl]
impl WorkEscrow {
    // -----------------------------------------------------------------------
    // Job lifecycle
    // -----------------------------------------------------------------------

    /// Create a job and return its id.
    ///
    /// The client signs this call. No funds move yet — call [`fund_job`]
    /// afterwards. `worker` may be `Some` to reserve the job for a specific
    /// account, or `None` to leave it open for any worker to accept.
    ///
    /// # Errors
    /// - [`Error::NoMilestones`] / [`Error::TooManyMilestones`]
    /// - [`Error::InvalidMilestoneAmount`] — a milestone amount was `<= 0`
    /// - [`Error::TitleTooLong`]
    /// - [`Error::ClientIsWorker`]
    /// - [`Error::InvalidDeadline`] — the deadline is not in the future
    /// - [`Error::Overflow`] — the milestone amounts summed past `i128::MAX`
    pub fn create_job(
        env: Env,
        client: Address,
        worker: Option<Address>,
        token: Address,
        milestones: Vec<MilestoneInput>,
        deadline: u64,
    ) -> Result<u64, Error> {
        client.require_auth();

        let count = milestones.len();
        if count == 0 {
            return Err(Error::NoMilestones);
        }
        if count > MAX_MILESTONES {
            return Err(Error::TooManyMilestones);
        }

        let now = env.ledger().timestamp();
        if deadline <= now {
            return Err(Error::InvalidDeadline);
        }

        if let Some(ref w) = worker {
            if *w == client {
                return Err(Error::ClientIsWorker);
            }
        }

        // Validate first, then build: a rejected job never touches storage.
        let mut total: i128 = 0;
        let mut stored: Vec<Milestone> = Vec::new(&env);
        for input in milestones.iter() {
            if input.amount <= 0 {
                return Err(Error::InvalidMilestoneAmount);
            }
            if input.title.len() > MAX_TITLE_LEN {
                return Err(Error::TitleTooLong);
            }
            total = total.checked_add(input.amount).ok_or(Error::Overflow)?;
            stored.push_back(Milestone {
                title: input.title.clone(),
                amount: input.amount,
                status: MilestoneStatus::Pending,
                submitted_at: 0,
                proof_hash: zero_hash(&env),
            });
        }

        let id = store::job_count(&env) + 1;
        let job = Job {
            id,
            client: client.clone(),
            worker: worker.clone(),
            token,
            total,
            released: 0,
            status: JobStatus::Open,
            created_at: now,
            deadline,
            milestones: stored,
        };

        store::set_job_count(&env, id);
        store::save_job(&env, &job);
        store::index_client(&env, &client, id);
        if let Some(w) = worker {
            store::index_worker(&env, &w, id);
        }

        events::job_created(&env, id, &client, &job.worker, total);
        Ok(id)
    }

    /// Move the client's full budget into the contract.
    ///
    /// Partial funding is intentionally not supported: a partially funded job
    /// would make milestone payouts ambiguous, and it would let a client
    /// occupy a worker with work it cannot pay for. The job must be `Open`.
    ///
    /// # Errors
    /// - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
    pub fn fund_job(env: Env, job_id: u64, client: Address) -> Result<(), Error> {
        let mut job = store::load_job(&env, job_id)?;
        if job.status != JobStatus::Open {
            return Err(Error::InvalidJobStatus);
        }
        if client != job.client {
            return Err(Error::Unauthorized);
        }
        client.require_auth();

        TokenClient::new(&env, &job.token).transfer(
            &client,
            &env.current_contract_address(),
            &job.total,
        );

        job.status = JobStatus::Funded;
        store::save_job(&env, &job);

        events::job_funded(&env, job_id, &client, job.total);
        Ok(())
    }

    /// Accept a job as `worker`.
    ///
    /// For an open job (`worker: None` at creation) the first caller wins. For
    /// a reserved job only the pre-assigned address may accept. The worker must
    /// be a different account from the client.
    ///
    /// # Errors
    /// - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
    /// - [`Error::Unauthorized`] — the job is reserved for a different account
    /// - [`Error::ClientIsWorker`]
    pub fn accept_job(env: Env, job_id: u64, worker: Address) -> Result<(), Error> {
        let mut job = store::load_job(&env, job_id)?;
        if job.status != JobStatus::Funded {
            return Err(Error::InvalidJobStatus);
        }
        if worker == job.client {
            return Err(Error::ClientIsWorker);
        }
        if let Some(ref reserved) = job.worker {
            if *reserved != worker {
                return Err(Error::Unauthorized);
            }
        }
        worker.require_auth();

        let was_open = job.worker.is_none();
        job.worker = Some(worker.clone());
        job.status = JobStatus::InProgress;
        store::save_job(&env, &job);
        if was_open {
            store::index_worker(&env, &worker, job_id);
        }

        events::job_accepted(&env, job_id, &worker);
        Ok(())
    }

    /// Cancel a job and return the full escrow to the client.
    ///
    /// Only possible while the job is `Open` (nothing escrowed) or `Funded`
    /// (escrowed, no worker has accepted). Once a worker has accepted, the
    /// client can no longer unilaterally take the money back: it has to settle
    /// a dispute or wait for `expire_job`.
    ///
    /// # Errors
    /// - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
    pub fn cancel_job(env: Env, job_id: u64, client: Address) -> Result<(), Error> {
        let mut job = store::load_job(&env, job_id)?;
        if client != job.client {
            return Err(Error::Unauthorized);
        }
        if job.status != JobStatus::Open && job.status != JobStatus::Funded {
            return Err(Error::InvalidJobStatus);
        }
        client.require_auth();

        // Only a `Funded` job holds tokens. An `Open` job was created but never
        // funded, so cancelling it must move nothing — refunding `total` there
        // would attempt a transfer out of an empty escrow.
        let refunded = if job.status == JobStatus::Funded {
            job.total
        } else {
            0
        };
        if refunded > 0 {
            pay(&env, &job.token, &client, refunded);
            events::paid(&env, job_id, &client, refunded, None);
        }
        job.released = job.total;
        job.status = JobStatus::Cancelled;
        store::save_job(&env, &job);

        events::job_cancelled(&env, job_id, refunded);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Work submission and payment
    // -----------------------------------------------------------------------

    /// Submit proof for a milestone. Only the assigned worker may call this.
    ///
    /// `proof_hash` is a SHA-256 commitment to the deliverable (a hash of the
    /// artifact, or of an IPFS CID / URL). The deliverable itself stays off
    /// chain; the contract only anchors *that a specific artifact was
    /// committed to at this ledger time*.
    ///
    /// # Errors
    /// - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
    /// - [`Error::NoWorker`] — nobody has accepted the job
    /// - [`Error::Unauthorized`] — the caller is not the assigned worker
    /// - [`Error::DeadlinePassed`]
    /// - [`Error::InvalidMilestoneIndex`]
    /// - [`Error::MilestoneAlreadyApproved`]
    pub fn submit_milestone(
        env: Env,
        job_id: u64,
        index: u32,
        worker: Address,
        proof_hash: BytesN<32>,
    ) -> Result<(), Error> {
        let mut job = store::load_job(&env, job_id)?;
        if job.status != JobStatus::InProgress {
            return Err(Error::InvalidJobStatus);
        }
        let assigned = job.worker.clone().ok_or(Error::NoWorker)?;
        if worker != assigned {
            return Err(Error::Unauthorized);
        }
        worker.require_auth();

        let now = env.ledger().timestamp();
        if now > job.deadline {
            return Err(Error::DeadlinePassed);
        }

        let mut milestone = job
            .milestones
            .get(index)
            .ok_or(Error::InvalidMilestoneIndex)?;
        match milestone.status {
            MilestoneStatus::Approved => return Err(Error::MilestoneAlreadyApproved),
            // Re-submitting replaces the previous proof, which lets a worker
            // correct an honest mistake. It cannot be used to escape the
            // deadline because the deadline check above still applies.
            MilestoneStatus::Submitted | MilestoneStatus::Pending => {}
        }

        milestone.status = MilestoneStatus::Submitted;
        milestone.submitted_at = now;
        milestone.proof_hash = proof_hash;
        job.milestones.set(index, milestone);
        store::save_job(&env, &job);

        events::milestone_submitted(&env, job_id, index, &worker);
        Ok(())
    }

    /// Approve a submitted milestone and pay the worker.
    ///
    /// Only the client may call this, and only a milestone that is actually
    /// `Submitted` — a client cannot pay itself, and it cannot pay a milestone
    /// that was never delivered.
    ///
    /// # Errors
    /// - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
    /// - [`Error::InvalidMilestoneIndex`]
    /// - [`Error::MilestoneNotSubmitted`] — nothing delivered yet
    /// - [`Error::MilestoneAlreadyApproved`]
    pub fn approve_milestone(env: Env, job_id: u64, index: u32) -> Result<(), Error> {
        let mut job = store::load_job(&env, job_id)?;
        if job.status != JobStatus::InProgress {
            return Err(Error::InvalidJobStatus);
        }
        job.client.require_auth();

        let mut milestone = job
            .milestones
            .get(index)
            .ok_or(Error::InvalidMilestoneIndex)?;
        match milestone.status {
            MilestoneStatus::Approved => return Err(Error::MilestoneAlreadyApproved),
            MilestoneStatus::Pending => return Err(Error::MilestoneNotSubmitted),
            MilestoneStatus::Submitted => {}
        }

        let worker = job.worker.clone().ok_or(Error::NoWorker)?;
        let amount = milestone.amount;

        milestone.status = MilestoneStatus::Approved;
        job.milestones.set(index, milestone);
        job.released = job.released.checked_add(amount).ok_or(Error::Overflow)?;

        pay(&env, &job.token, &worker, amount);
        events::paid(&env, job_id, &worker, amount, Some(index));

        if all_approved(&job) {
            job.status = JobStatus::Completed;
            events::job_completed(&env, job_id, job.released);
        }
        store::save_job(&env, &job);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Dispute handling
    // -----------------------------------------------------------------------

    /// Freeze automated payouts and start a negotiation.
    ///
    /// Either party may open a dispute. While disputed, `expire_job` is blocked
    /// and no milestone can be approved. Either party may `close_dispute` to
    /// return to normal operation, so a dispute delays but never permanently
    /// locks the escrow.
    ///
    /// # Errors
    /// - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
    /// - [`Error::Unauthorized`] — caller is neither client nor worker
    /// - [`Error::ReasonTooLong`]
    pub fn open_dispute(
        env: Env,
        job_id: u64,
        caller: Address,
        reason: String,
    ) -> Result<(), Error> {
        let mut job = store::load_job(&env, job_id)?;
        if job.status != JobStatus::InProgress {
            return Err(Error::InvalidJobStatus);
        }
        if reason.len() > MAX_REASON_LEN {
            return Err(Error::ReasonTooLong);
        }
        require_participant(&job, &caller)?;
        caller.require_auth();

        job.status = JobStatus::Disputed;
        store::save_job(&env, &job);

        events::dispute_opened(&env, job_id, &caller);
        Ok(())
    }

    /// Close an open dispute and resume normal operation.
    ///
    /// Callable by either party; a stale or bad-faith dispute therefore cannot
    /// trap the escrow indefinitely.
    pub fn close_dispute(env: Env, job_id: u64, caller: Address) -> Result<(), Error> {
        let mut job = store::load_job(&env, job_id)?;
        if job.status != JobStatus::Disputed {
            return Err(Error::InvalidJobStatus);
        }
        require_participant(&job, &caller)?;
        caller.require_auth();

        job.status = JobStatus::InProgress;
        store::save_job(&env, &job);
        store::clear_settlement(&env, job_id);

        events::dispute_closed(&env, job_id);
        Ok(())
    }

    /// Propose how to split the remaining escrow. Only while disputed.
    ///
    /// `client_amount` is the part returned to the client; the worker receives
    /// `escrowed - client_amount`. The counterparty must call
    /// [`accept_settlement`] to execute it, so neither side can unilaterally
    /// decide the split.
    ///
    /// # Errors
    /// - [`Error::SettlementRequiresDispute`]
    /// - [`Error::SettlementAlreadyProposed`]
    /// - [`Error::SettlementExceedsBalance`] — `client_amount` outside `[0, escrowed]`
    /// - [`Error::Unauthorized`]
    pub fn propose_settlement(
        env: Env,
        job_id: u64,
        proposer: Address,
        client_amount: i128,
    ) -> Result<(), Error> {
        let job = store::load_job(&env, job_id)?;
        if job.status != JobStatus::Disputed {
            return Err(Error::SettlementRequiresDispute);
        }
        require_participant(&job, &proposer)?;
        proposer.require_auth();

        if store::load_settlement(&env, job_id).is_some() {
            return Err(Error::SettlementAlreadyProposed);
        }

        let escrowed = job.escrowed();
        if client_amount < 0 || client_amount > escrowed {
            return Err(Error::SettlementExceedsBalance);
        }

        store::save_settlement(
            &env,
            job_id,
            &Settlement {
                client_amount,
                worker_amount: escrowed - client_amount,
                proposed_by: proposer.clone(),
            },
        );

        events::settlement_proposed(
            &env,
            job_id,
            client_amount,
            escrowed - client_amount,
            &proposer,
        );
        Ok(())
    }

    /// Accept the outstanding settlement proposal and move the funds.
    ///
    /// Only the counterparty of the proposer may accept. Executing pays the
    /// client `client_amount` and the worker the remainder, then completes the
    /// job. Because the contract holds the tokens, neither transfer can fail
    /// for insufficient balance.
    ///
    /// # Errors
    /// - [`Error::NoSettlement`]
    /// - [`Error::SettlementSelfAccept`] — the proposer cannot accept its own terms
    /// - [`Error::SettlementRequiresDispute`]
    pub fn accept_settlement(env: Env, job_id: u64, acceptor: Address) -> Result<(), Error> {
        let mut job = store::load_job(&env, job_id)?;
        if job.status != JobStatus::Disputed {
            return Err(Error::SettlementRequiresDispute);
        }
        require_participant(&job, &acceptor)?;
        acceptor.require_auth();

        let settlement = store::load_settlement(&env, job_id).ok_or(Error::NoSettlement)?;
        if settlement.proposed_by == acceptor {
            return Err(Error::SettlementSelfAccept);
        }

        let worker = job.worker.clone().ok_or(Error::NoWorker)?;

        if settlement.client_amount > 0 {
            pay(&env, &job.token, &job.client, settlement.client_amount);
            events::paid(&env, job_id, &job.client, settlement.client_amount, None);
        }
        if settlement.worker_amount > 0 {
            pay(&env, &job.token, &worker, settlement.worker_amount);
            events::paid(&env, job_id, &worker, settlement.worker_amount, None);
        }

        job.released = job.released
            .checked_add(settlement.client_amount)
            .and_then(|v| v.checked_add(settlement.worker_amount))
            .ok_or(Error::Overflow)?;
        job.status = JobStatus::Completed;
        store::save_job(&env, &job);
        store::clear_settlement(&env, job_id);

        events::settlement_accepted(
            &env,
            job_id,
            settlement.client_amount,
            settlement.worker_amount,
        );
        events::job_completed(&env, job_id, job.released);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Deadline
    // -----------------------------------------------------------------------

    /// Unwind an escrow whose deadline has passed. Callable by **anyone**.
    ///
    /// Payouts are fully deterministic, which is what makes a permissionless
    /// trigger safe:
    /// - milestones never delivered (`Pending`) are refunded to the client;
    /// - milestones delivered before the deadline (`Submitted`) are paid to the
    ///   worker;
    /// - milestones already paid are left alone.
    ///
    /// A dispute blocks this call. To avoid a permanent deadlock, either party
    /// can `close_dispute` and then trigger expiry.
    ///
    /// # Errors
    /// - [`Error::JobNotFound`]
    /// - [`Error::InvalidJobStatus`] — already terminal, or disputed
    /// - [`Error::DeadlineNotPassed`]
    pub fn expire_job(env: Env, job_id: u64) -> Result<(), Error> {
        let mut job = store::load_job(&env, job_id)?;
        if job.status == JobStatus::Disputed {
            return Err(Error::InvalidJobStatus);
        }
        if job.status != JobStatus::Funded && job.status != JobStatus::InProgress {
            return Err(Error::InvalidJobStatus);
        }
        if env.ledger().timestamp() <= job.deadline {
            return Err(Error::DeadlineNotPassed);
        }

        let worker = job.worker.clone();
        let mut to_client: i128 = 0;
        let mut to_worker: i128 = 0;

        for i in 0..job.milestones.len() {
            let mut milestone = job.milestones.get_unchecked(i);
            match milestone.status {
                MilestoneStatus::Pending => {
                    to_client = to_client
                        .checked_add(milestone.amount)
                        .ok_or(Error::Overflow)?;
                }
                MilestoneStatus::Submitted => {
                    to_worker = to_worker
                        .checked_add(milestone.amount)
                        .ok_or(Error::Overflow)?;
                    milestone.status = MilestoneStatus::Approved;
                    job.milestones.set(i, milestone);
                }
                MilestoneStatus::Approved => {}
            }
        }

        if to_client > 0 {
            pay(&env, &job.token, &job.client, to_client);
            events::paid(&env, job_id, &job.client, to_client, None);
        }
        if to_worker > 0 {
            let w = worker.ok_or(Error::NoWorker)?;
            pay(&env, &job.token, &w, to_worker);
            events::paid(&env, job_id, &w, to_worker, None);
        }

        job.released = job.released
            .checked_add(to_client)
            .and_then(|v| v.checked_add(to_worker))
            .ok_or(Error::Overflow)?;
        job.status = JobStatus::Expired;
        store::save_job(&env, &job);

        events::job_expired(&env, job_id, to_client, to_worker);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// Fetch a single job.
    pub fn get_job(env: Env, job_id: u64) -> Result<Job, Error> {
        store::load_job(&env, job_id)
    }

    /// Total number of jobs ever created.
    pub fn get_job_count(env: Env) -> u64 {
        store::job_count(&env)
    }

    /// Page over every job, newest-first is **not** guaranteed — ids ascend.
    pub fn get_jobs(env: Env, start: u32, limit: u32) -> Result<Vec<Job>, Error> {
        check_page(limit)?;
        let count = store::job_count(&env);
        let mut out = Vec::new(&env);
        let mut i = start as u64 + 1;
        while i <= count && out.len() < limit {
            out.push_back(store::load_job(&env, i)?);
            i += 1;
        }
        Ok(out)
    }

    /// Job ids created by `client`, paginated.
    pub fn get_jobs_for_client(
        env: Env,
        client: Address,
        start: u32,
        limit: u32,
    ) -> Result<Vec<u64>, Error> {
        check_page(limit)?;
        Ok(store::page_index(
            &env,
            store::client_jobs_key(&client),
            start,
            limit,
        ))
    }

    /// Job ids accepted by `worker`, paginated.
    pub fn get_jobs_for_worker(
        env: Env,
        worker: Address,
        start: u32,
        limit: u32,
    ) -> Result<Vec<u64>, Error> {
        check_page(limit)?;
        Ok(store::page_index(
            &env,
            store::worker_jobs_key(&worker),
            start,
            limit,
        ))
    }

    /// Value still held by the contract for this job.
    pub fn get_escrowed(env: Env, job_id: u64) -> Result<i128, Error> {
        Ok(store::load_job(&env, job_id)?.escrowed())
    }

    /// The outstanding settlement proposal, if any.
    pub fn get_settlement(env: Env, job_id: u64) -> Option<Settlement> {
        store::load_settlement(&env, job_id)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn zero_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn all_approved(job: &Job) -> bool {
    for i in 0..job.milestones.len() {
        if job.milestones.get_unchecked(i).status != MilestoneStatus::Approved {
            return false;
        }
    }
    job.milestones.len() > 0
}

fn check_page(limit: u32) -> Result<(), Error> {
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return Err(Error::InvalidPageSize);
    }
    Ok(())
}

fn require_participant(job: &Job, caller: &Address) -> Result<(), Error> {
    let is_client = *caller == job.client;
    let is_worker = match &job.worker {
        Some(w) => *caller == *w,
        None => false,
    };
    if is_client || is_worker {
        Ok(())
    } else {
        Err(Error::Unauthorized)
    }
}

/// Transfer `amount` out of the escrow. The contract authorises its own
/// transfers, so no user signature is required for this leg — the signature
/// requirement was already enforced by `require_auth` on the entry point.
fn pay(env: &Env, token: &Address, to: &Address, amount: i128) {
    if amount <= 0 {
        return;
    }
    TokenClient::new(env, token).transfer(&env.current_contract_address(), to, &amount);
}
