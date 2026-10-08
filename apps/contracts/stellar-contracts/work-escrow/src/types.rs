//! Public data types and the storage keys used by the escrow contract.

use soroban_sdk::{contracttype, Address, BytesN, String, Vec};

/// Maximum number of milestones a single job may define.
///
/// This bound is a deliberate denial-of-service guard: `expire_job` and
/// `accept_settlement` iterate over every milestone, so an unbounded list would
/// let a client create a job that can never be settled within the ledger's
/// instruction budget.
pub const MAX_MILESTONES: u32 = 20;

/// Maximum byte length of a milestone title.
pub const MAX_TITLE_LEN: u32 = 64;

/// Maximum byte length of a dispute reason.
pub const MAX_REASON_LEN: u32 = 256;

/// Maximum number of jobs returned by a single paged view call.
pub const MAX_PAGE_SIZE: u32 = 20;

/// Lifecycle of an escrowed job.
///
/// Legal transitions (enforced in `lib.rs`):
///
/// ```text
/// Open ──fund_job──▶ Funded ──accept_job──▶ InProgress ──all milestones paid──▶ Completed
///   │                   │                       │
///   │                   └──cancel_job──▶ Cancelled
///   │                                           ├──open_dispute──▶ Disputed
///   └────────────────── expire_job ───┐         │                     │
///                                     ▼         │      accept_settlement
///                                  Expired ◀────┘                     ▼
///                                                                Completed
/// ```
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobStatus {
    /// Created by the client, no funds escrowed yet. Not payable.
    Open,
    /// The client's full budget is held by the contract. Awaits `accept_job`.
    Funded,
    /// A worker has accepted. Work may be submitted and paid out.
    InProgress,
    /// A party raised a dispute. Automated payouts are frozen until the
    /// dispute is closed or the parties agree a settlement.
    Disputed,
    /// Every milestone has been paid. Terminal.
    Completed,
    /// Cancelled by the client before the worker accepted. Funds returned. Terminal.
    Cancelled,
    /// The deadline passed and the escrow was unwound. Terminal.
    Expired,
}

/// Lifecycle of a single milestone.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    /// Not yet delivered. The escrowed amount for it is refundable to the client.
    Pending,
    /// The worker submitted proof before the deadline. Awaiting client review.
    Submitted,
    /// Paid to the worker. Terminal.
    Approved,
}

/// A milestone as stored on chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    /// Short human-readable label, e.g. "Design mockups". Bounded by
    /// [`MAX_TITLE_LEN`].
    pub title: String,
    /// Amount of `Job::token` released to the worker when this milestone is
    /// approved. Always strictly positive.
    pub amount: i128,
    pub status: MilestoneStatus,
    /// Ledger timestamp of `submit_milestone`, or `0` while `Pending`.
    pub submitted_at: u64,
    /// SHA-256 of the deliverable (or of an IPFS CID / URL). The deliverable
    /// itself is intentionally kept off chain; only this commitment is stored.
    /// Zeroed until the milestone is submitted.
    pub proof_hash: BytesN<32>,
}

/// Input supplied by the client when creating a job.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneInput {
    pub title: String,
    pub amount: i128,
}

/// A fully stored job.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Job {
    pub id: u64,
    /// The party funding the escrow. Only this address can approve payouts.
    pub client: Address,
    /// `None` while the job is open, or the pre-assigned worker.
    pub worker: Option<Address>,
    /// SEP-41 token contract used for escrow (e.g. the native XLM SAC).
    pub token: Address,
    /// Sum of all milestone amounts. Fixed at creation time.
    pub total: i128,
    /// Amount already transferred out to the worker.
    pub released: i128,
    pub status: JobStatus,
    pub created_at: u64,
    /// Unix timestamp after which `expire_job` may unwind the escrow.
    pub deadline: u64,
    pub milestones: Vec<Milestone>,
}

impl Job {
    /// Total value still held by the contract for this job.
    ///
    /// Returns `0` rather than a negative number in the impossible case of a
    /// corrupted record, so that a view call can never underflow.
    pub fn escrowed(&self) -> i128 {
        self.total.saturating_sub(self.released)
    }
}

/// A settlement proposal raised while a job is disputed.
///
/// Settlement is the only mechanism that resolves a dispute, and it requires
/// the **counterparty** of the proposer to accept it. There is deliberately no
/// arbitrator or admin key that can move funds.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Settlement {
    /// Portion of the escrowed balance that would be returned to the client.
    pub client_amount: i128,
    /// Portion that would be paid to the worker: escrowed - `client_amount`.
    pub worker_amount: i128,
    /// The party that proposed the split.
    pub proposed_by: Address,
}

/// Storage keys.
///
/// `Job` records live in **persistent** storage (one entry per job, TTL bumped
/// on every access). The counters live in **instance** storage because they are
/// touched by every `create_job` and must share the contract instance's TTL.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Global job id counter (`u64`).
    JobCount,
    /// A single job, keyed by id.
    Job(u64),
    /// Ids of jobs created by a client (`Vec<u64>`).
    ClientJobs(Address),
    /// Ids of jobs a worker has accepted (`Vec<u64>`).
    WorkerJobs(Address),
    /// Outstanding settlement proposal for a job.
    Settlement(u64),
}
