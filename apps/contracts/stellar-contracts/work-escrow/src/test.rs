//! Escrow contract test suite.
//!
//! Organised by concern: creation, funding, acceptance, submission, approval,
//! cancellation, expiry, disputes, settlements, views and authorisation.
//!
//! Two distinct classes of negative test appear throughout, and they verify
//! different things:
//!
//! * **Domain rejections** (`Error::Unauthorized`, `Error::InvalidJobStatus`, …)
//!   are produced by explicit checks in the contract. These run with auth
//!   mocked, so they prove the *business rule*, not the signature.
//! * **Signature enforcement** is covered by the `auth_enforced_*` tests, which
//!   clear the mocked auth set and assert that the call is rejected outright.

extern crate std;

use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::xdr::ScVal;
use soroban_sdk::{Address, BytesN, Env, String, Symbol, TryFromVal, Vec};

use crate::{
    Error, Job, JobStatus, MilestoneInput, MilestoneStatus, Settlement, WorkEscrow,
    WorkEscrowClient, MAX_MILESTONES, MAX_PAGE_SIZE,
};

const START: u64 = 1_700_000_000;
const DAY: u64 = 86_400;
const UNIT: i128 = 10_000_000; // 1 token at 7 decimals

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

struct Fx {
    env: Env,
    id: Address,
    token: Address,
    client_addr: Address,
    worker_addr: Address,
    stranger: Address,
}

impl Fx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(START);

        let id = env.register(WorkEscrow, ());
        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let client_addr = Address::generate(&env);
        let worker_addr = Address::generate(&env);
        let stranger = Address::generate(&env);

        // `Env` is a handle but is not `Copy`, so it is moved in last.
        Fx {
            env,
            id,
            token,
            client_addr,
            worker_addr,
            stranger,
        }
    }

    fn contract(&self) -> WorkEscrowClient<'_> {
        WorkEscrowClient::new(&self.env, &self.id)
    }

    fn mint(&self, to: &Address, amount: i128) {
        StellarAssetClient::new(&self.env, &self.token).mint(to, &amount);
    }

    fn fund_client(&self, amount: i128) {
        self.mint(&self.client_addr, amount);
    }

    fn balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.env, &self.token).balance(who)
    }

    fn escrow_balance(&self) -> i128 {
        self.balance(&self.id)
    }

    fn deadline(&self) -> u64 {
        START + DAY
    }

    fn at(&self, ts: u64) {
        self.env.ledger().set_timestamp(ts);
    }

    /// Create a single-milestone, unassigned job. Nothing is minted and nothing
    /// is escrowed, so tests control the client's balance themselves.
    /// Status: `Open`.
    fn created_job(&self, amount: i128) -> u64 {
        self.contract().create_job(
            &self.client_addr,
            &None,
            &self.token,
            &milestones(&self.env, &[("Deliverable", amount)]),
            &self.deadline(),
        )
    }

    /// Create and fund a single-milestone job, minting the budget to the client.
    /// Status: `Funded`, awaiting a worker.
    fn open_job(&self, amount: i128) -> u64 {
        self.fund_client(amount);
        let id = self.created_job(amount);
        self.contract().fund_job(&id, &self.client_addr);
        id
    }

    /// Create, fund and accept a single-milestone job. Status: `InProgress`.
    fn active_job(&self, amount: i128) -> u64 {
        let id = self.open_job(amount);
        self.contract().accept_job(&id, &self.worker_addr);
        id
    }

    fn proof(&self, byte: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[byte; 32])
    }

    /// Every event the escrow contract has emitted so far, in order.
    ///
    /// Filtering by contract id matters: a payout also makes the token contract
    /// emit its own `transfer` event, which would otherwise be the "last" one.
    fn escrow_events(&self) -> std::vec::Vec<Symbol> {
        use soroban_sdk::xdr::ContractEventBody as Body;
        let captured = self.env.events().all().filter_by_contract(&self.id);
        let mut out: std::vec::Vec<Symbol> = std::vec::Vec::new();
        for event in captured.events().iter() {
            let Body::V0(v0) = &event.body;
            // topics[0] is the `escrow` namespace, topics[1] is the event name.
            if let Some(ScVal::Symbol(s)) = v0.topics.get(1) {
                out.push(Symbol::try_from_val(&self.env, s).unwrap());
            }
        }
        out
    }

    /// The namespace topic shared by every event, read from the last invocation.
    fn event_namespace(&self) -> Symbol {
        use soroban_sdk::xdr::ContractEventBody as Body;
        let captured = self.env.events().all().filter_by_contract(&self.id);
        let event = captured.events().first().expect("no escrow event");
        let Body::V0(v0) = &event.body;
        match v0.topics.first() {
            Some(ScVal::Symbol(s)) => Symbol::try_from_val(&self.env, s).unwrap(),
            _ => panic!("event has no namespace topic"),
        }
    }

    /// Symbol topic of the most recent escrow event.
    fn last_topic(&self) -> Symbol {
        let events = self.escrow_events();
        events.last().expect("no escrow event emitted").clone()
    }
}

fn milestones(env: &Env, items: &[(&str, i128)]) -> Vec<MilestoneInput> {
    let mut v = Vec::new(env);
    for (title, amount) in items.iter() {
        v.push_back(MilestoneInput {
            title: String::from_str(env, title),
            amount: *amount,
        });
    }
    v
}

/// Topic symbols expected from an event assertion, in order.
fn symbols(f: &Fx, names: &[&str]) -> std::vec::Vec<Symbol> {
    names.iter().map(|n| Symbol::new(&f.env, n)).collect()
}



// ---------------------------------------------------------------------------
// create_job
// ---------------------------------------------------------------------------

#[test]
fn create_job_returns_ascending_ids_and_persists_fields() {
    let f = Fx::new();
    let c = f.contract();

    let a = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("Design", 5 * UNIT), ("Build", 15 * UNIT)]),
            &f.deadline(),
        )
        ;
    let b = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("Write", UNIT)]),
            &f.deadline(),
        )
        ;

    assert_eq!(a, 1);
    assert_eq!(b, 2);
    assert_eq!(f.last_topic(), Symbol::new(&f.env, "job_new"));
    assert_eq!(c.get_job_count(), 2);

    let job: Job = c.get_job(&a);
    assert_eq!(job.id, a);
    assert_eq!(job.client, f.client_addr);
    assert_eq!(job.worker, None);
    assert_eq!(job.token, f.token);
    assert_eq!(job.total, 20 * UNIT);
    assert_eq!(job.released, 0);
    assert_eq!(job.status, JobStatus::Open);
    assert_eq!(job.created_at, START);
    assert_eq!(job.deadline, f.deadline());
    assert_eq!(job.milestones.len(), 2);
    assert_eq!(job.milestones.get(0).unwrap().status, MilestoneStatus::Pending);
    assert_eq!(job.milestones.get(0).unwrap().submitted_at, 0);
    assert_eq!(
        job.milestones.get(0).unwrap().title,
        String::from_str(&f.env, "Design")
    );
}

#[test]
fn create_job_reserves_a_named_worker() {
    let f = Fx::new();
    let c = f.contract();
    let id = c
        .create_job(
            &f.client_addr,
            &Some(f.worker_addr.clone()),
            &f.token,
            &milestones(&f.env, &[("Task", UNIT)]),
            &f.deadline(),
        )
        ;
    assert_eq!(c.get_job(&id).worker, Some(f.worker_addr.clone()));
    // The reserved worker is indexed immediately so the job shows up in their list.
    let ids = c.get_jobs_for_worker(&f.worker_addr, &0, &10);
    assert_eq!(ids.len(), 1);
    assert_eq!(ids.get(0).unwrap(), id);
}

#[test]
fn create_job_rejects_empty_milestones() {
    let f = Fx::new();
    let c = f.contract();
    assert_eq!(
        c.try_create_job(
            &f.client_addr,
            &None,
            &f.token,
            &Vec::new(&f.env),
            &f.deadline()
        ),
        Err(Ok(Error::NoMilestones))
    );
}

#[test]
fn create_job_rejects_too_many_milestones() {
    let f = Fx::new();
    let c = f.contract();
    let mut many: Vec<MilestoneInput> = Vec::new(&f.env);
    for i in 0..(MAX_MILESTONES + 1) {
        many.push_back(MilestoneInput {
            title: String::from_str(&f.env, "m"),
            amount: (i as i128) + 1,
        });
    }
    assert_eq!(
        c.try_create_job(&f.client_addr, &None, &f.token, &many, &f.deadline()),
        Err(Ok(Error::TooManyMilestones))
    );
}

#[test]
fn create_job_accepts_exactly_max_milestones() {
    let f = Fx::new();
    let c = f.contract();
    let mut many: Vec<MilestoneInput> = Vec::new(&f.env);
    for i in 0..MAX_MILESTONES {
        many.push_back(MilestoneInput {
            title: String::from_str(&f.env, "m"),
            amount: (i as i128) + 1,
        });
    }
    c
        .create_job(&f.client_addr, &None, &f.token, &many, &f.deadline());
}

#[test]
fn create_job_rejects_non_positive_amounts() {
    let f = Fx::new();
    let c = f.contract();
    for bad in [0i128, -1i128, i128::MIN] {
        assert_eq!(
            c.try_create_job(
                &f.client_addr,
                &None,
                &f.token,
                &milestones(&f.env, &[("Task", bad)]),
                &f.deadline()
            ),
            Err(Ok(Error::InvalidMilestoneAmount)),
            "amount {bad} should be rejected"
        );
    }
}

#[test]
fn create_job_rejects_overlong_title() {
    let f = Fx::new();
    let c = f.contract();
    let long = "x".repeat(65);
    assert_eq!(
        c.try_create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[(&long, UNIT)]),
            &f.deadline()
        ),
        Err(Ok(Error::TitleTooLong))
    );
}

#[test]
fn create_job_accepts_max_length_title() {
    let f = Fx::new();
    let c = f.contract();
    let exact = "x".repeat(64);
    c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[(&exact, UNIT)]),
            &f.deadline()
        );
}

#[test]
fn create_job_rejects_non_future_deadline() {
    let f = Fx::new();
    let c = f.contract();
    for bad in [0u64, START, START - 1] {
        assert_eq!(
            c.try_create_job(
                &f.client_addr,
                &None,
                &f.token,
                &milestones(&f.env, &[("Task", UNIT)]),
                &bad
            ),
            Err(Ok(Error::InvalidDeadline))
        );
    }
}

#[test]
fn create_job_rejects_client_as_worker() {
    let f = Fx::new();
    let c = f.contract();
    assert_eq!(
        c.try_create_job(
            &f.client_addr,
            &Some(f.client_addr.clone()),
            &f.token,
            &milestones(&f.env, &[("Task", UNIT)]),
            &f.deadline()
        ),
        Err(Ok(Error::ClientIsWorker))
    );
}

#[test]
fn create_job_rejects_total_overflow() {
    let f = Fx::new();
    let c = f.contract();
    assert_eq!(
        c.try_create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("A", i128::MAX), ("B", 1)]),
            &f.deadline()
        ),
        Err(Ok(Error::Overflow))
    );
}

#[test]
fn create_job_does_not_touch_storage_when_invalid() {
    let f = Fx::new();
    let c = f.contract();
    let _ = c.try_create_job(
        &f.client_addr,
        &None,
        &f.token,
        &milestones(&f.env, &[("Bad", 0)]),
        &f.deadline(),
    );
    assert_eq!(c.get_job_count(), 0);
}

// ---------------------------------------------------------------------------
// fund_job
// ---------------------------------------------------------------------------

#[test]
fn fund_job_escrows_the_full_budget() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(100 * UNIT);
    let id = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("A", 40 * UNIT), ("B", 60 * UNIT)]),
            &f.deadline(),
        )
        ;

    c.fund_job(&id, &f.client_addr);
    // Asserted before any view call: `events().all()` only reports the events of
    // the most recent invocation.
    assert_eq!(f.last_topic(), Symbol::new(&f.env, "job_fund"));

    assert_eq!(f.escrow_balance(), 100 * UNIT);
    assert_eq!(f.balance(&f.client_addr), 0);
    assert_eq!(c.get_job(&id).status, JobStatus::Funded);
}

#[test]
fn fund_job_rejects_double_funding() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.created_job(10 * UNIT);
    f.fund_client(10 * UNIT);
    c.fund_job(&id, &f.client_addr);

    assert_eq!(
        c.try_fund_job(&id, &f.client_addr),
        Err(Ok(Error::InvalidJobStatus))
    );
    // The second call must not have moved any additional tokens.
    assert_eq!(f.escrow_balance(), 10 * UNIT);
}

#[test]
fn fund_job_rejects_a_caller_that_is_not_the_client() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.created_job(10 * UNIT);
    f.mint(&f.stranger, 10 * UNIT);

    assert_eq!(
        c.try_fund_job(&id, &f.stranger),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(f.balance(&f.stranger), 10 * UNIT);
}

#[test]
fn fund_job_rejects_unknown_job() {
    let f = Fx::new();
    let c = f.contract();
    assert_eq!(
        c.try_fund_job(&999u64, &f.client_addr),
        Err(Ok(Error::JobNotFound))
    );
}

#[test]
fn fund_job_fails_when_the_client_cannot_cover_the_budget() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.created_job(10 * UNIT);
    // Only half the budget is minted.
    f.fund_client(5 * UNIT);
    assert!(c.try_fund_job(&id, &f.client_addr).is_err());
    // The job must not be marked funded, so the client can retry.
    assert_eq!(c.get_job(&id).status, JobStatus::Open);
    assert_eq!(f.escrow_balance(), 0);
}

// ---------------------------------------------------------------------------
// accept_job
// ---------------------------------------------------------------------------

#[test]
fn accept_job_first_come_first_served_for_open_jobs() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.open_job(UNIT);
    c.accept_job(&id, &f.worker_addr);
    assert_eq!(f.last_topic(), Symbol::new(&f.env, "job_take"));

    let job = c.get_job(&id);
    assert_eq!(job.worker, Some(f.worker_addr.clone()));
    assert_eq!(job.status, JobStatus::InProgress);

    let ids = c.get_jobs_for_worker(&f.worker_addr, &0, &10);
    assert_eq!(ids.get(0).unwrap(), id);
}

#[test]
fn accept_job_only_by_the_reserved_worker() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(UNIT);
    let id = c
        .create_job(
            &f.client_addr,
            &Some(f.worker_addr.clone()),
            &f.token,
            &milestones(&f.env, &[("Task", UNIT)]),
            &f.deadline(),
        )
        ;
    c.fund_job(&id, &f.client_addr);

    assert_eq!(
        c.try_accept_job(&id, &f.stranger),
        Err(Ok(Error::Unauthorized))
    );

    c.accept_job(&id, &f.worker_addr);
    assert_eq!(c.get_job(&id).worker, Some(f.worker_addr.clone()));
}

#[test]
fn accept_job_requires_funding_first() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(UNIT);
    let id = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("Task", UNIT)]),
            &f.deadline(),
        )
        ;

    assert_eq!(
        c.try_accept_job(&id, &f.worker_addr),
        Err(Ok(Error::InvalidJobStatus))
    );
}

#[test]
fn accept_job_rejects_the_client_itself() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.open_job(UNIT);
    assert_eq!(
        c.try_accept_job(&id, &f.client_addr),
        Err(Ok(Error::ClientIsWorker))
    );
}

#[test]
fn accept_job_rejects_a_second_worker() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    assert_eq!(
        c.try_accept_job(&id, &f.stranger),
        Err(Ok(Error::InvalidJobStatus))
    );
    assert_eq!(c.get_job(&id).worker, Some(f.worker_addr.clone()));
}

// ---------------------------------------------------------------------------
// submit_milestone
// ---------------------------------------------------------------------------

#[test]
fn submit_milestone_records_proof_and_timestamp() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    let proof = f.proof(0xAB);

    c.submit_milestone(&id, &0u32, &f.worker_addr, &proof);
    assert_eq!(f.last_topic(), Symbol::new(&f.env, "ms_submit"));

    let m = c.get_job(&id).milestones.get(0).unwrap();
    assert_eq!(m.status, MilestoneStatus::Submitted);
    assert_eq!(m.proof_hash, proof);
    assert_eq!(m.submitted_at, START);
}

#[test]
fn submit_milestone_rejects_a_non_worker() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    assert_eq!(
        c.try_submit_milestone(&id, &0u32, &f.stranger, &f.proof(1)),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        c.get_job(&id).milestones.get(0).unwrap().status,
        MilestoneStatus::Pending
    );
}

#[test]
fn submit_milestone_rejects_the_client() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    assert_eq!(
        c.try_submit_milestone(&id, &0u32, &f.client_addr, &f.proof(1)),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn submit_milestone_requires_an_accepted_worker() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.open_job(UNIT);
    assert_eq!(
        c.try_submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1)),
        Err(Ok(Error::InvalidJobStatus))
    );
}

#[test]
fn submit_milestone_rejects_an_out_of_range_index() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    assert_eq!(
        c.try_submit_milestone(&id, &5u32, &f.worker_addr, &f.proof(1)),
        Err(Ok(Error::InvalidMilestoneIndex))
    );
}

#[test]
fn submit_milestone_rejects_work_after_the_deadline() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    f.at(f.deadline() + 1);
    assert_eq!(
        c.try_submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1)),
        Err(Ok(Error::DeadlinePassed))
    );
}

#[test]
fn submit_milestone_is_allowed_exactly_on_the_deadline() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    f.at(f.deadline());
    c
        .submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
}

#[test]
fn submit_milestone_can_replace_an_earlier_proof() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
    f.at(START + 3600);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(2));

    let m = c.get_job(&id).milestones.get(0).unwrap();
    assert_eq!(m.proof_hash, f.proof(2));
    assert_eq!(m.submitted_at, START + 3600);
}

#[test]
fn submit_milestone_rejects_an_already_paid_milestone() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
    c.approve_milestone(&id, &0u32);
    assert_eq!(
        c.try_submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(3)),
        Err(Ok(Error::InvalidJobStatus)) // job is Completed now
    );
}

// ---------------------------------------------------------------------------
// approve_milestone
// ---------------------------------------------------------------------------

#[test]
fn approve_milestone_pays_only_the_worker() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
    c.approve_milestone(&id, &0u32);
    assert_eq!(f.last_topic(), Symbol::new(&f.env, "job_done"));

    assert_eq!(f.balance(&f.worker_addr), 10 * UNIT);
    assert_eq!(f.balance(&f.client_addr), 0, "client must never be paid");
    assert_eq!(f.escrow_balance(), 0);
}

#[test]
fn approve_milestone_rejects_an_undelivered_milestone() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    assert_eq!(
        c.try_approve_milestone(&id, &0u32),
        Err(Ok(Error::MilestoneNotSubmitted))
    );
    assert_eq!(f.balance(&f.worker_addr), 0);
}

#[test]
fn approve_milestone_rejects_a_double_payout() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
    c.approve_milestone(&id, &0u32);
    assert_eq!(
        c.try_approve_milestone(&id, &0u32),
        Err(Ok(Error::InvalidJobStatus))
    );
    assert_eq!(f.balance(&f.worker_addr), UNIT);
}

#[test]
fn approve_milestone_rejects_a_pending_milestone_in_a_partly_paid_job() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(2 * UNIT);
    let id = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("A", UNIT), ("B", UNIT)]),
            &f.deadline(),
        )
        ;
    c.fund_job(&id, &f.client_addr);
    c.accept_job(&id, &f.worker_addr);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
    c.approve_milestone(&id, &0u32);

    // Milestone 1 was never delivered.
    assert_eq!(
        c.try_approve_milestone(&id, &1u32),
        Err(Ok(Error::MilestoneNotSubmitted))
    );
}

#[test]
fn approve_milestone_requires_the_clients_signature() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));

    // `approve_milestone` takes no caller argument: the client's *signature* is
    // what authorises the payout. With the auth set cleared, neither the worker
    // nor anyone else can release the funds.
    f.env.mock_auths(&[]);
    assert!(c.try_approve_milestone(&id, &0u32).is_err());
    assert_eq!(f.balance(&f.worker_addr), 0);
    assert_eq!(f.escrow_balance(), 10 * UNIT);
}

// ---------------------------------------------------------------------------
// Full workflow
// ---------------------------------------------------------------------------

#[test]
fn full_three_milestone_workflow_releases_every_payment() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(30 * UNIT);

    let id = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(
                &f.env,
                &[("Design", 10 * UNIT), ("Build", 15 * UNIT), ("Ship", 5 * UNIT)],
            ),
            &f.deadline(),
        )
        ;

    c.fund_job(&id, &f.client_addr);
    assert_eq!(f.escrow_balance(), 30 * UNIT);
    c.accept_job(&id, &f.worker_addr);

    for i in 0..3u32 {
        c.submit_milestone(&id, &i, &f.worker_addr, &f.proof(i as u8));
        c.approve_milestone(&id, &i);
    }

    let job = c.get_job(&id);
    assert_eq!(job.status, JobStatus::Completed);
    assert_eq!(job.released, 30 * UNIT);
    assert_eq!(f.balance(&f.worker_addr), 30 * UNIT);
    assert_eq!(f.balance(&f.client_addr), 0);
    assert_eq!(f.escrow_balance(), 0, "contract must hold nothing after completion");

    for i in 0..3u32 {
        assert_eq!(
            job.milestones.get(i).unwrap().status,
            MilestoneStatus::Approved
        );
    }
    assert_eq!(c.get_escrowed(&id), 0);

    // Terminal: no further state changes are possible.
    assert!(c.try_accept_settlement(&id, &f.worker_addr).is_err());
    assert!(c.try_expire_job(&id).is_err());
}

#[test]
fn partial_approval_keeps_the_job_in_progress() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(20 * UNIT);
    let id = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("A", 5 * UNIT), ("B", 15 * UNIT)]),
            &f.deadline(),
        )
        ;
    c.fund_job(&id, &f.client_addr);
    c.accept_job(&id, &f.worker_addr);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
    c.approve_milestone(&id, &0u32);

    let job = c.get_job(&id);
    assert_eq!(job.status, JobStatus::InProgress);
    assert_eq!(job.released, 5 * UNIT);
    assert_eq!(c.get_escrowed(&id), 15 * UNIT);
    assert_eq!(f.escrow_balance(), 15 * UNIT);
}

// ---------------------------------------------------------------------------
// cancel_job
// ---------------------------------------------------------------------------

#[test]
fn cancel_unfunded_job_moves_no_funds() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(UNIT);
    let id = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("Task", UNIT)]),
            &f.deadline(),
        )
        ;

    c.cancel_job(&id, &f.client_addr);
    assert_eq!(c.get_job(&id).status, JobStatus::Cancelled);
    // The job was never funded, so cancelling it moves nothing at all.
    assert_eq!(f.balance(&f.client_addr), UNIT);
    assert_eq!(f.escrow_balance(), 0);
    assert_eq!(c.get_escrowed(&id), 0);
}

#[test]
fn cancel_funded_job_refunds_the_client_in_full() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.open_job(10 * UNIT);
    assert_eq!(f.balance(&f.client_addr), 0);

    c.cancel_job(&id, &f.client_addr);
    assert_eq!(f.last_topic(), Symbol::new(&f.env, "job_cncl"));

    assert_eq!(f.balance(&f.client_addr), 10 * UNIT);
    assert_eq!(f.escrow_balance(), 0);
    assert_eq!(c.get_job(&id).status, JobStatus::Cancelled);
}

#[test]
fn cancel_is_impossible_once_a_worker_has_accepted() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);

    assert_eq!(
        c.try_cancel_job(&id, &f.client_addr),
        Err(Ok(Error::InvalidJobStatus))
    );
    assert_eq!(f.escrow_balance(), 10 * UNIT, "funds must stay escrowed");
}

#[test]
fn cancel_rejects_a_non_client() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.open_job(UNIT);
    assert_eq!(
        c.try_cancel_job(&id, &f.stranger),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(f.escrow_balance(), UNIT);
}

#[test]
fn cancel_rejects_an_already_cancelled_job() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.open_job(UNIT);
    c.cancel_job(&id, &f.client_addr);
    let before = f.balance(&f.client_addr);
    assert_eq!(
        c.try_cancel_job(&id, &f.client_addr),
        Err(Ok(Error::InvalidJobStatus))
    );
    assert_eq!(f.balance(&f.client_addr), before);
}

// ---------------------------------------------------------------------------
// expire_job
// ---------------------------------------------------------------------------

#[test]
fn expire_before_the_deadline_is_rejected() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    assert_eq!(c.try_expire_job(&id), Err(Ok(Error::DeadlineNotPassed)));
    f.at(f.deadline());
    assert_eq!(c.try_expire_job(&id), Err(Ok(Error::DeadlineNotPassed)));
}

#[test]
fn expire_refunds_undelivered_milestones_to_the_client() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    f.at(f.deadline() + 1);

    c.expire_job(&id);
    assert_eq!(f.last_topic(), Symbol::new(&f.env, "job_exp"));

    assert_eq!(f.balance(&f.client_addr), 10 * UNIT);
    assert_eq!(f.balance(&f.worker_addr), 0);
    assert_eq!(f.escrow_balance(), 0);
    assert_eq!(c.get_job(&id).status, JobStatus::Expired);
}

#[test]
fn expire_pays_delivered_milestones_to_the_worker_and_refunds_the_rest() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(30 * UNIT);
    let id = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("Done", 10 * UNIT), ("NotDone", 20 * UNIT)]),
            &f.deadline(),
        )
        ;
    c.fund_job(&id, &f.client_addr);
    c.accept_job(&id, &f.worker_addr);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));

    f.at(f.deadline() + 1);
    c.expire_job(&id);

    assert_eq!(f.balance(&f.worker_addr), 10 * UNIT, "delivered work is paid");
    assert_eq!(f.balance(&f.client_addr), 20 * UNIT, "undelivered work is refunded");
    assert_eq!(f.escrow_balance(), 0);

    let job = c.get_job(&id);
    assert_eq!(job.status, JobStatus::Expired);
    assert_eq!(job.released, 30 * UNIT);
    assert_eq!(job.milestones.get(0).unwrap().status, MilestoneStatus::Approved);
    assert_eq!(job.milestones.get(1).unwrap().status, MilestoneStatus::Pending);
}

#[test]
fn expire_refunds_an_unaccepted_job_to_the_client() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.open_job(7 * UNIT);

    f.at(f.deadline() + 1);
    c.expire_job(&id);

    assert_eq!(f.balance(&f.client_addr), 7 * UNIT);
    assert_eq!(f.escrow_balance(), 0);
}

#[test]
fn expire_is_permissionless() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    f.at(f.deadline() + 1);

    // No signature at all: the payouts are deterministic, so anyone may trigger it.
    f.env.mock_auths(&[]);
    c.expire_job(&id);

    assert_eq!(f.balance(&f.client_addr), 10 * UNIT);
}

#[test]
fn expire_does_not_double_pay_a_partly_paid_job() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(20 * UNIT);
    let id = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("A", 5 * UNIT), ("B", 15 * UNIT)]),
            &f.deadline(),
        )
        ;
    c.fund_job(&id, &f.client_addr);
    c.accept_job(&id, &f.worker_addr);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
    c.approve_milestone(&id, &0u32);

    f.at(f.deadline() + 1);
    c.expire_job(&id);

    assert_eq!(f.balance(&f.worker_addr), 5 * UNIT, "no double payout");
    assert_eq!(f.balance(&f.client_addr), 15 * UNIT);
    assert_eq!(f.escrow_balance(), 0);
}

#[test]
fn expire_is_rejected_on_a_completed_or_cancelled_job() {
    let f = Fx::new();
    let c = f.contract();

    // Both jobs are set up before the clock moves, so neither creation is
    // rejected for a deadline that has already passed.
    let done = f.active_job(UNIT);
    c.submit_milestone(&done, &0u32, &f.worker_addr, &f.proof(1));
    c.approve_milestone(&done, &0u32);

    let cancelled = f.open_job(UNIT);
    c.cancel_job(&cancelled, &f.client_addr);

    f.at(f.deadline() + 1);
    assert_eq!(c.try_expire_job(&done), Err(Ok(Error::InvalidJobStatus)));
    assert_eq!(
        c.try_expire_job(&cancelled),
        Err(Ok(Error::InvalidJobStatus))
    );
}

#[test]
fn expire_cannot_be_triggered_twice() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    f.at(f.deadline() + 1);
    c.expire_job(&id);
    assert_eq!(c.try_expire_job(&id), Err(Ok(Error::InvalidJobStatus)));
    assert_eq!(f.balance(&f.client_addr), 10 * UNIT);
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

#[test]
fn either_party_can_open_a_dispute() {
    let f = Fx::new();
    let c = f.contract();

    let a = f.active_job(UNIT);
    c.open_dispute(&a, &f.client_addr, &String::from_str(&f.env, "not as agreed"));
    assert_eq!(f.last_topic(), Symbol::new(&f.env, "dispute"));
    assert_eq!(c.get_job(&a).status, JobStatus::Disputed);

    let b = f.active_job(UNIT);
    c.open_dispute(&b, &f.worker_addr, &String::from_str(&f.env, "scope creep"))
        ;
    assert_eq!(c.get_job(&b).status, JobStatus::Disputed);
}

#[test]
fn a_stranger_cannot_open_a_dispute() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    assert_eq!(
        c.try_open_dispute(&id, &f.stranger, &String::from_str(&f.env, "x")),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn a_dispute_requires_an_active_job() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.open_job(UNIT);
    assert_eq!(
        c.try_open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "x")),
        Err(Ok(Error::InvalidJobStatus))
    );
}

#[test]
fn an_overlong_dispute_reason_is_rejected() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    let long = "r".repeat(257);
    assert_eq!(
        c.try_open_dispute(&id, &f.client_addr, &String::from_str(&f.env, &long)),
        Err(Ok(Error::ReasonTooLong))
    );
}

#[test]
fn a_dispute_freezes_submission_and_approval() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
    c.open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "quality"))
        ;

    assert_eq!(
        c.try_approve_milestone(&id, &0u32),
        Err(Ok(Error::InvalidJobStatus))
    );
    assert_eq!(
        c.try_submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(2)),
        Err(Ok(Error::InvalidJobStatus))
    );
    assert_eq!(f.balance(&f.worker_addr), 0);
}

#[test]
fn a_dispute_blocks_deadline_expiry() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.open_dispute(&id, &f.worker_addr, &String::from_str(&f.env, "unpaid"))
        ;
    f.at(f.deadline() + 1);
    assert_eq!(c.try_expire_job(&id), Err(Ok(Error::InvalidJobStatus)));
    assert_eq!(f.escrow_balance(), 10 * UNIT);
}

#[test]
fn closing_a_dispute_returns_to_normal_operation() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "x"))
        ;

    // Either party can clear a stale dispute, so it can never trap funds.
    c.close_dispute(&id, &f.worker_addr);
    assert_eq!(f.last_topic(), Symbol::new(&f.env, "dispute_x"));
    assert_eq!(c.get_job(&id).status, JobStatus::InProgress);

    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
    c.approve_milestone(&id, &0u32);
    assert_eq!(f.balance(&f.worker_addr), 10 * UNIT);
}

#[test]
fn closing_a_dispute_requires_a_participant_and_an_open_dispute() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    assert_eq!(
        c.try_close_dispute(&id, &f.client_addr),
        Err(Ok(Error::InvalidJobStatus))
    );
    c.open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "x"))
        ;
    assert_eq!(
        c.try_close_dispute(&id, &f.stranger),
        Err(Ok(Error::Unauthorized))
    );
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

#[test]
fn settlement_requires_a_dispute() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(UNIT);
    assert_eq!(
        c.try_propose_settlement(&id, &f.client_addr, &0i128),
        Err(Ok(Error::SettlementRequiresDispute))
    );
}

#[test]
fn settlement_cannot_be_accepted_by_its_own_proposer() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "x"))
        ;
    c.propose_settlement(&id, &f.client_addr, &(5 * UNIT));

    assert_eq!(
        c.try_accept_settlement(&id, &f.client_addr),
        Err(Ok(Error::SettlementSelfAccept))
    );
    // Nothing has moved yet.
    assert_eq!(f.escrow_balance(), 10 * UNIT);
}

#[test]
fn settlement_split_pays_both_parties() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "half done"))
        ;
    c.propose_settlement(&id, &f.client_addr, &(4 * UNIT));

    let s: Settlement = c.get_settlement(&id).unwrap();
    assert_eq!(s.client_amount, 4 * UNIT);
    assert_eq!(s.worker_amount, 6 * UNIT);
    assert_eq!(s.proposed_by, f.client_addr);

    c.accept_settlement(&id, &f.worker_addr);

    assert_eq!(f.balance(&f.client_addr), 4 * UNIT);
    assert_eq!(f.balance(&f.worker_addr), 6 * UNIT);
    assert_eq!(f.escrow_balance(), 0);
    assert_eq!(c.get_job(&id).status, JobStatus::Completed);
    assert!(c.get_settlement(&id).is_none(), "proposal must be cleared");
}

#[test]
fn a_zero_share_settlement_is_allowed_for_either_side() {
    let f = Fx::new();
    let c = f.contract();

    // Worker concedes everything to the client.
    let a = f.active_job(10 * UNIT);
    c.open_dispute(&a, &f.client_addr, &String::from_str(&f.env, "x"))
        ;
    c.propose_settlement(&a, &f.worker_addr, &(10 * UNIT));
    c.accept_settlement(&a, &f.client_addr);
    assert_eq!(f.balance(&f.client_addr), 10 * UNIT);
    assert_eq!(f.balance(&f.worker_addr), 0);

    // Client concedes everything to the worker.
    let b = f.active_job(10 * UNIT);
    c.open_dispute(&b, &f.client_addr, &String::from_str(&f.env, "y"))
        ;
    c.propose_settlement(&b, &f.client_addr, &0i128);
    c.accept_settlement(&b, &f.worker_addr);
    assert_eq!(f.balance(&f.worker_addr), 10 * UNIT);
}

#[test]
fn settlement_cannot_exceed_the_escrowed_balance() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "x"))
        ;

    for bad in [10 * UNIT + 1, -1] {
        assert_eq!(
            c.try_propose_settlement(&id, &f.client_addr, &bad),
            Err(Ok(Error::SettlementExceedsBalance))
        );
    }
}

#[test]
fn settlement_only_splits_the_still_escrowed_balance() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(20 * UNIT);
    let id = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("A", 5 * UNIT), ("B", 15 * UNIT)]),
            &f.deadline(),
        )
        ;
    c.fund_job(&id, &f.client_addr);
    c.accept_job(&id, &f.worker_addr);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
    c.approve_milestone(&id, &0u32);
    // 5 already paid; 15 still escrowed.

    c.open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "rest"))
        ;
    assert_eq!(
        c.try_propose_settlement(&id, &f.client_addr, &(15 * UNIT + 1)),
        Err(Ok(Error::SettlementExceedsBalance))
    );

    c.propose_settlement(&id, &f.client_addr, &(5 * UNIT));
    c.accept_settlement(&id, &f.worker_addr);

    assert_eq!(f.balance(&f.worker_addr), 5 * UNIT + 10 * UNIT);
    assert_eq!(f.balance(&f.client_addr), 5 * UNIT);
    assert_eq!(f.escrow_balance(), 0);
}

#[test]
fn only_one_settlement_can_be_outstanding() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "x"))
        ;
    c.propose_settlement(&id, &f.client_addr, &(4 * UNIT));
    assert_eq!(
        c.try_propose_settlement(&id, &f.worker_addr, &(1 * UNIT)),
        Err(Ok(Error::SettlementAlreadyProposed))
    );
}

#[test]
fn only_participants_can_propose_or_accept() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "x"))
        ;
    assert_eq!(
        c.try_propose_settlement(&id, &f.stranger, &(1 * UNIT)),
        Err(Ok(Error::Unauthorized))
    );
    c.propose_settlement(&id, &f.client_addr, &(1 * UNIT));
    assert_eq!(
        c.try_accept_settlement(&id, &f.stranger),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn accepting_a_settlement_requires_a_proposal() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "x"))
        ;
    assert_eq!(
        c.try_accept_settlement(&id, &f.worker_addr),
        Err(Ok(Error::NoSettlement))
    );
}

#[test]
fn closing_a_dispute_discards_an_outstanding_proposal() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "x"))
        ;
    c.propose_settlement(&id, &f.client_addr, &(4 * UNIT));
    c.close_dispute(&id, &f.client_addr);
    assert!(c.get_settlement(&id).is_none());
}

// ---------------------------------------------------------------------------
// Views and pagination
// ---------------------------------------------------------------------------

#[test]
fn get_job_rejects_an_unknown_id() {
    let f = Fx::new();
    let c = f.contract();
    assert_eq!(c.try_get_job(&1u64), Err(Ok(Error::JobNotFound)));
    assert_eq!(c.try_get_escrowed(&1u64), Err(Ok(Error::JobNotFound)));
}

#[test]
fn pagination_rejects_invalid_page_sizes() {
    let f = Fx::new();
    let c = f.contract();
    assert_eq!(c.try_get_jobs(&0u32, &0u32), Err(Ok(Error::InvalidPageSize)));
    assert_eq!(
        c.try_get_jobs(&0u32, &(MAX_PAGE_SIZE + 1)),
        Err(Ok(Error::InvalidPageSize))
    );
}

#[test]
fn pagination_walks_every_job_once() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(5 * UNIT);
    for i in 0..5u32 {
        let _ = c.create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("Task", (i as i128 + 1) * UNIT)]),
            &f.deadline(),
        );
    }
    assert_eq!(c.get_job_count(), 5);

    let first = c.get_jobs(&0u32, &2u32);
    assert_eq!(first.len(), 2);
    assert_eq!(first.get(0).unwrap().id, 1);
    assert_eq!(first.get(1).unwrap().id, 2);

    let second = c.get_jobs(&2u32, &2u32);
    assert_eq!(second.len(), 2);
    assert_eq!(second.get(0).unwrap().id, 3);

    // Reading past the end returns an empty page rather than an error.
    let past = c.get_jobs(&99u32, &5u32);
    assert_eq!(past.len(), 0);
}

#[test]
fn participant_indexes_are_paged_and_separate() {
    let f = Fx::new();
    let c = f.contract();
    f.fund_client(2 * UNIT);
    let a = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("A", UNIT)]),
            &f.deadline(),
        )
        ;
    let b = c
        .create_job(
            &f.client_addr,
            &None,
            &f.token,
            &milestones(&f.env, &[("B", UNIT)]),
            &f.deadline(),
        )
        ;
    c.fund_job(&a, &f.client_addr);
    c.fund_job(&b, &f.client_addr);
    c.accept_job(&a, &f.worker_addr);

    let client_jobs = c.get_jobs_for_client(&f.client_addr, &0, &10);
    assert_eq!(client_jobs.len(), 2);
    assert_eq!(client_jobs.get(0).unwrap(), a);

    let worker_jobs = c.get_jobs_for_worker(&f.worker_addr, &0, &10);
    assert_eq!(worker_jobs.len(), 1, "worker index only holds accepted jobs");
    assert_eq!(worker_jobs.get(0).unwrap(), a);

    let other = c.get_jobs_for_worker(&f.stranger, &0, &10);
    assert_eq!(other.len(), 0);

    let page = c.get_jobs_for_client(&f.client_addr, &1, &10);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap(), b);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[test]
fn every_state_change_emits_its_topic() {
    let f = Fx::new();
    let c = f.contract();

    f.fund_client(10 * UNIT);
    let id = c.create_job(
        &f.client_addr,
        &None,
        &f.token,
        &milestones(&f.env, &[("Work", 10 * UNIT)]),
        &f.deadline(),
    );
    assert_eq!(f.escrow_events(), symbols(&f, &["job_new"]));
    // Every event is namespaced so an indexer can subscribe to `escrow.*`.
    assert_eq!(f.event_namespace(), Symbol::new(&f.env, "escrow"));

    c.fund_job(&id, &f.client_addr);
    assert_eq!(f.escrow_events(), symbols(&f, &["job_fund"]));

    c.accept_job(&id, &f.worker_addr);
    assert_eq!(f.escrow_events(), symbols(&f, &["job_take"]));

    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));
    assert_eq!(f.escrow_events(), symbols(&f, &["ms_submit"]));

    // Approving the last milestone pays out and then completes the job. The
    // payout event must come first so an indexer can attribute the transfer
    // before the job leaves the active set.
    c.approve_milestone(&id, &0u32);
    assert_eq!(f.escrow_events(), symbols(&f, &["paid", "job_done"]));

    // A cancellation refunds and announces the cancellation.
    let id2 = f.open_job(5 * UNIT);
    c.cancel_job(&id2, &f.client_addr);
    assert_eq!(f.escrow_events(), symbols(&f, &["paid", "job_cncl"]));

    // Disputes and settlements announce themselves too.
    let id3 = f.active_job(5 * UNIT);
    c.open_dispute(&id3, &f.client_addr, &String::from_str(&f.env, "scope"));
    assert_eq!(f.escrow_events(), symbols(&f, &["dispute"]));
    c.propose_settlement(&id3, &f.client_addr, &(2 * UNIT));
    assert_eq!(f.escrow_events(), symbols(&f, &["settle"]));
    c.accept_settlement(&id3, &f.worker_addr);
    assert_eq!(
        f.escrow_events(),
        symbols(&f, &["paid", "paid", "settle_ok", "job_done"])
    );
}

// ---------------------------------------------------------------------------
// Signature enforcement (no mocked auth)
// ---------------------------------------------------------------------------

#[test]
fn auth_is_enforced_for_every_signed_entry_point() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.active_job(10 * UNIT);
    c.submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1));

    // Drop every mocked authorisation: unsigned calls must now be rejected.
    f.env.mock_auths(&[]);

    assert!(c.try_create_job(
        &f.client_addr,
        &None,
        &f.token,
        &milestones(&f.env, &[("X", UNIT)]),
        &f.deadline()
    )
    .is_err());
    assert!(c.try_fund_job(&id, &f.client_addr).is_err());
    assert!(c.try_accept_job(&id, &f.worker_addr).is_err());
    assert!(c
        .try_submit_milestone(&id, &0u32, &f.worker_addr, &f.proof(1))
        .is_err());
    assert!(c.try_approve_milestone(&id, &0u32).is_err());
    assert!(c
        .try_cancel_job(&id, &f.client_addr)
        .is_err());
    assert!(c
        .try_open_dispute(&id, &f.client_addr, &String::from_str(&f.env, "x"))
        .is_err());
    assert!(c
        .try_propose_settlement(&id, &f.client_addr, &0i128)
        .is_err());
    assert!(c.try_accept_settlement(&id, &f.worker_addr).is_err());

    // ...and no funds moved.
    assert_eq!(f.escrow_balance(), 10 * UNIT);
    assert_eq!(f.balance(&f.worker_addr), 0);
}

#[test]
fn unsigned_views_remain_readable() {
    let f = Fx::new();
    let c = f.contract();
    let id = f.open_job(UNIT);

    f.env.mock_auths(&[]);
    assert_eq!(c.get_job(&id).status, JobStatus::Funded);
    assert_eq!(c.get_job_count(), 1);
    assert_eq!(c.get_jobs(&0u32, &5u32).len(), 1);
    assert_eq!(c.get_escrowed(&id), UNIT);
}
