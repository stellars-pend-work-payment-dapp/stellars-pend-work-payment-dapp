//! Typed storage accessors.
//!
//! Keeping every `env.storage()` call in this module means the TTL policy is
//! applied uniformly: reading or writing a persistent entry always extends its
//! lifetime, so an escrow that sits untouched for months does not silently
//! disappear from the ledger and strand user funds.

use soroban_sdk::{Address, Env, Vec};

use crate::error::Error;
use crate::types::{DataKey, Job, Settlement};

/// ~30 days of ledgers (Stellar closes a ledger roughly every 5 seconds).
const PERSISTENT_BUMP: u32 = 518_400;
/// Bump when fewer than ~7 days of lifetime remain.
const PERSISTENT_THRESHOLD: u32 = 120_960;

// ---------------------------------------------------------------------------
// Counters (instance storage)
// ---------------------------------------------------------------------------

pub fn job_count(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::JobCount).unwrap_or(0)
}

pub fn set_job_count(env: &Env, count: u64) {
    env.storage().instance().set(&DataKey::JobCount, &count);
    env.storage().instance().extend_ttl(PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

// ---------------------------------------------------------------------------
// Jobs (persistent storage)
// ---------------------------------------------------------------------------

pub fn save_job(env: &Env, job: &Job) {
    let key = DataKey::Job(job.id);
    env.storage().persistent().set(&key, job);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

/// Load a job, refreshing its TTL. Returns [`Error::JobNotFound`] if absent.
pub fn load_job(env: &Env, job_id: u64) -> Result<Job, Error> {
    let key = DataKey::Job(job_id);
    let job: Option<Job> = env.storage().persistent().get(&key);
    match job {
        Some(j) => {
            env.storage()
                .persistent()
                .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
            Ok(j)
        }
        None => Err(Error::JobNotFound),
    }
}

// ---------------------------------------------------------------------------
// Per-participant indexes
// ---------------------------------------------------------------------------

fn push_index(env: &Env, key: DataKey, id: u64) {
    let mut ids: Vec<u64> = env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env));
    ids.push_back(id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

/// Record that `client` created job `id`.
pub fn index_client(env: &Env, client: &Address, id: u64) {
    push_index(env, DataKey::ClientJobs(client.clone()), id);
}

/// Record that `worker` accepted job `id`.
pub fn index_worker(env: &Env, worker: &Address, id: u64) {
    push_index(env, DataKey::WorkerJobs(worker.clone()), id);
}

/// Page through the ids in an index. `start` is the number of entries to skip.
pub fn page_index(env: &Env, key: DataKey, start: u32, limit: u32) -> Vec<u64> {
    let ids: Vec<u64> = env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env));
    let total = ids.len();
    let mut out = Vec::new(env);
    let mut i = start;
    while i < total && out.len() < limit {
        out.push_back(ids.get_unchecked(i));
        i += 1;
    }
    out
}

pub fn client_jobs_key(client: &Address) -> DataKey {
    DataKey::ClientJobs(client.clone())
}

pub fn worker_jobs_key(worker: &Address) -> DataKey {
    DataKey::WorkerJobs(worker.clone())
}

// ---------------------------------------------------------------------------
// Settlement proposals
// ---------------------------------------------------------------------------

pub fn save_settlement(env: &Env, job_id: u64, settlement: &Settlement) {
    let key = DataKey::Settlement(job_id);
    env.storage().persistent().set(&key, settlement);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn load_settlement(env: &Env, job_id: u64) -> Option<Settlement> {
    let key = DataKey::Settlement(job_id);
    match env.storage().persistent().get::<DataKey, Settlement>(&key) {
        Some(s) => {
            env.storage()
                .persistent()
                .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
            Some(s)
        }
        None => None,
    }
}

pub fn clear_settlement(env: &Env, job_id: u64) {
    env.storage().persistent().remove(&DataKey::Settlement(job_id));
}
