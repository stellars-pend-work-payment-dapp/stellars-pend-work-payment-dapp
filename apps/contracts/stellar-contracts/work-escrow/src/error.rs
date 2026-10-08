//! Contract error codes.
//!
//! Every failure path in the escrow contract returns one of these. They are
//! part of the public ABI: the frontend maps the numeric code back to a
//! human-readable message (see `packages/contracts/escrow`), so codes must
//! never be renumbered once a contract is deployed.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The referenced job id does not exist.
    JobNotFound = 1,
    /// The job is not in the state required by the called function.
    InvalidJobStatus = 2,
    /// A milestone index was out of range for this job.
    InvalidMilestoneIndex = 3,
    /// A milestone amount was zero or negative.
    InvalidMilestoneAmount = 4,
    /// A job must define at least one milestone.
    NoMilestones = 5,
    /// A job defined more milestones than `MAX_MILESTONES`.
    TooManyMilestones = 6,
    /// The deadline is not in the future (checked at creation time).
    InvalidDeadline = 7,
    /// The job deadline has not passed yet.
    DeadlineNotPassed = 8,
    /// The job deadline has passed; new work can no longer be submitted.
    DeadlinePassed = 9,
    /// The caller is not authorised to perform this action.
    Unauthorized = 10,
    /// The caller is not the worker of this job.
    NotWorker = 11,
    /// The job has no worker assigned yet.
    NoWorker = 12,
    /// The client and the worker must be different accounts.
    ClientIsWorker = 13,
    /// A milestone title exceeded `MAX_TITLE_LEN` bytes.
    TitleTooLong = 14,
    /// A dispute reason exceeded `MAX_REASON_LEN` bytes.
    ReasonTooLong = 15,
    /// A checked arithmetic operation overflowed.
    Overflow = 16,
    /// The milestone has not been submitted and cannot be approved yet.
    MilestoneNotSubmitted = 17,
    /// The milestone has already been paid out.
    MilestoneAlreadyApproved = 18,
    /// The job must be in dispute before a settlement can be proposed.
    SettlementRequiresDispute = 19,
    /// No settlement proposal is currently outstanding.
    NoSettlement = 20,
    /// The proposed client share is larger than the escrowed balance.
    SettlementExceedsBalance = 21,
    /// A settlement must be accepted by the counterparty, not the proposer.
    SettlementSelfAccept = 22,
    /// A settlement proposal is already outstanding.
    SettlementAlreadyProposed = 23,
    /// A page size of zero, or larger than `MAX_PAGE_SIZE`, was requested.
    InvalidPageSize = 24,
}
