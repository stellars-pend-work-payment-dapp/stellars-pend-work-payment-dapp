//! Contract events.
//!
//! Every state-changing entry point publishes exactly one event. Event names
//! live in a fixed two-level namespace — `("escrow", "<event>")` — so an indexer
//! can subscribe to `escrow.*` and still tell this contract's events apart from
//! any other contract emitting a similarly named one.
//!
//! Topic layout is part of the public API. Renaming an event, or moving a field
//! between `#[topic]` and the data section, is a breaking change for consumers.
//!
//! | Event               | Topics after the namespace | Data                                        |
//! | ------------------- | -------------------------- | ------------------------------------------- |
//! | `job_new`           | `client`, `job_id`         | `worker`, `total`                           |
//! | `job_fund`          | `client`, `job_id`         | `amount`                                    |
//! | `job_take`          | `worker`, `job_id`         | —                                           |
//! | `ms_submit`         | `worker`, `job_id`         | `index`                                     |
//! | `paid`              | `to`, `job_id`             | `amount`, `milestone`                       |
//! | `job_done`          | —                          | `job_id`, `released`                        |
//! | `job_cncl`          | —                          | `job_id`, `refunded`                        |
//! | `job_exp`           | —                          | `job_id`, `refunded`, `released`            |
//! | `dispute`           | `opened_by`, `job_id`      | —                                           |
//! | `dispute_x`         | —                          | `job_id`                                    |
//! | `settle`            | `by`, `job_id`             | `client_amount`, `worker_amount`            |
//! | `settle_ok`         | —                          | `job_id`, `client_amount`, `worker_amount`  |

use soroban_sdk::{contractevent, Address, Env};

/// Emitted by `create_job`.
#[contractevent(topics = ["escrow", "job_new"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobCreated {
    /// The account that will fund the escrow.
    #[topic]
    pub client: Address,
    #[topic]
    pub job_id: u64,
    /// Pre-assigned worker, if the job was reserved for a specific account.
    pub worker: Option<Address>,
    /// Total budget to be escrowed.
    pub total: i128,
}

/// Emitted by `fund_job`.
#[contractevent(topics = ["escrow", "job_fund"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobFunded {
    #[topic]
    pub client: Address,
    #[topic]
    pub job_id: u64,
    /// Amount now held by the contract for this job.
    pub amount: i128,
}

/// Emitted by `accept_job`.
#[contractevent(topics = ["escrow", "job_take"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobAccepted {
    #[topic]
    pub worker: Address,
    #[topic]
    pub job_id: u64,
}

/// Emitted by `submit_milestone`.
#[contractevent(topics = ["escrow", "ms_submit"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneSubmitted {
    #[topic]
    pub worker: Address,
    #[topic]
    pub job_id: u64,
    pub index: u32,
}

/// Emitted whenever funds leave the escrow, for any reason.
#[contractevent(topics = ["escrow", "paid"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Paid {
    #[topic]
    pub to: Address,
    #[topic]
    pub job_id: u64,
    pub amount: i128,
    /// `Some(index)` for a milestone payout, `None` for a refund or settlement.
    pub milestone: Option<u32>,
}

/// Emitted when a job reaches a terminal, fully settled state.
#[contractevent(topics = ["escrow", "job_done"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobCompleted {
    pub job_id: u64,
    pub released: i128,
}

/// Emitted by `cancel_job`.
#[contractevent(topics = ["escrow", "job_cncl"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobCancelled {
    pub job_id: u64,
    pub refunded: i128,
}

/// Emitted by `expire_job`.
#[contractevent(topics = ["escrow", "job_exp"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobExpired {
    pub job_id: u64,
    pub refunded: i128,
    pub released: i128,
}

/// Emitted by `open_dispute`.
#[contractevent(topics = ["escrow", "dispute"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeOpened {
    #[topic]
    pub opened_by: Address,
    #[topic]
    pub job_id: u64,
}

/// Emitted by `close_dispute`.
#[contractevent(topics = ["escrow", "dispute_x"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeClosed {
    pub job_id: u64,
}

/// Emitted by `propose_settlement`.
#[contractevent(topics = ["escrow", "settle"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementProposed {
    #[topic]
    pub by: Address,
    #[topic]
    pub job_id: u64,
    pub client_amount: i128,
    pub worker_amount: i128,
}

/// Emitted by `accept_settlement` once the split has been paid out.
#[contractevent(topics = ["escrow", "settle_ok"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementAccepted {
    pub job_id: u64,
    pub client_amount: i128,
    pub worker_amount: i128,
}

// ---------------------------------------------------------------------------
// Emission helpers
// ---------------------------------------------------------------------------

pub fn job_created(
    env: &Env,
    job_id: u64,
    client: &Address,
    worker: &Option<Address>,
    total: i128,
) {
    JobCreated {
        client: client.clone(),
        job_id,
        worker: worker.clone(),
        total,
    }
    .publish(env);
}

pub fn job_funded(env: &Env, job_id: u64, client: &Address, amount: i128) {
    JobFunded {
        client: client.clone(),
        job_id,
        amount,
    }
    .publish(env);
}

pub fn job_accepted(env: &Env, job_id: u64, worker: &Address) {
    JobAccepted {
        worker: worker.clone(),
        job_id,
    }
    .publish(env);
}

pub fn milestone_submitted(env: &Env, job_id: u64, index: u32, worker: &Address) {
    MilestoneSubmitted {
        worker: worker.clone(),
        job_id,
        index,
    }
    .publish(env);
}

pub fn paid(env: &Env, job_id: u64, to: &Address, amount: i128, milestone: Option<u32>) {
    Paid {
        to: to.clone(),
        job_id,
        amount,
        milestone,
    }
    .publish(env);
}

pub fn job_completed(env: &Env, job_id: u64, released: i128) {
    JobCompleted { job_id, released }.publish(env);
}

pub fn job_cancelled(env: &Env, job_id: u64, refunded: i128) {
    JobCancelled { job_id, refunded }.publish(env);
}

pub fn job_expired(env: &Env, job_id: u64, refunded: i128, released: i128) {
    JobExpired {
        job_id,
        refunded,
        released,
    }
    .publish(env);
}

pub fn dispute_opened(env: &Env, job_id: u64, opened_by: &Address) {
    DisputeOpened {
        opened_by: opened_by.clone(),
        job_id,
    }
    .publish(env);
}

pub fn dispute_closed(env: &Env, job_id: u64) {
    DisputeClosed { job_id }.publish(env);
}

pub fn settlement_proposed(
    env: &Env,
    job_id: u64,
    client_amount: i128,
    worker_amount: i128,
    by: &Address,
) {
    SettlementProposed {
        by: by.clone(),
        job_id,
        client_amount,
        worker_amount,
    }
    .publish(env);
}

pub fn settlement_accepted(env: &Env, job_id: u64, client_amount: i128, worker_amount: i128) {
    SettlementAccepted {
        job_id,
        client_amount,
        worker_amount,
    }
    .publish(env);
}
