import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}

export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CCW4F4X7EMES6UKWL3S3PJGK4MMYHPYMMZZGEBUF5QQJVM2FPM6AFRHC",
  },
} as const;

export const Errors = {
  /**
   * The referenced job id does not exist.
   */
  1: { message: "JobNotFound" },
  /**
   * The job is not in the state required by the called function.
   */
  2: { message: "InvalidJobStatus" },
  /**
   * A milestone index was out of range for this job.
   */
  3: { message: "InvalidMilestoneIndex" },
  /**
   * A milestone amount was zero or negative.
   */
  4: { message: "InvalidMilestoneAmount" },
  /**
   * A job must define at least one milestone.
   */
  5: { message: "NoMilestones" },
  /**
   * A job defined more milestones than `MAX_MILESTONES`.
   */
  6: { message: "TooManyMilestones" },
  /**
   * The deadline is not in the future (checked at creation time).
   */
  7: { message: "InvalidDeadline" },
  /**
   * The job deadline has not passed yet.
   */
  8: { message: "DeadlineNotPassed" },
  /**
   * The job deadline has passed; new work can no longer be submitted.
   */
  9: { message: "DeadlinePassed" },
  /**
   * The caller is not authorised to perform this action.
   */
  10: { message: "Unauthorized" },
  /**
   * The caller is not the worker of this job.
   */
  11: { message: "NotWorker" },
  /**
   * The job has no worker assigned yet.
   */
  12: { message: "NoWorker" },
  /**
   * The client and the worker must be different accounts.
   */
  13: { message: "ClientIsWorker" },
  /**
   * A milestone title exceeded `MAX_TITLE_LEN` bytes.
   */
  14: { message: "TitleTooLong" },
  /**
   * A dispute reason exceeded `MAX_REASON_LEN` bytes.
   */
  15: { message: "ReasonTooLong" },
  /**
   * A checked arithmetic operation overflowed.
   */
  16: { message: "Overflow" },
  /**
   * The milestone has not been submitted and cannot be approved yet.
   */
  17: { message: "MilestoneNotSubmitted" },
  /**
   * The milestone has already been paid out.
   */
  18: { message: "MilestoneAlreadyApproved" },
  /**
   * The job must be in dispute before a settlement can be proposed.
   */
  19: { message: "SettlementRequiresDispute" },
  /**
   * No settlement proposal is currently outstanding.
   */
  20: { message: "NoSettlement" },
  /**
   * The proposed client share is larger than the escrowed balance.
   */
  21: { message: "SettlementExceedsBalance" },
  /**
   * A settlement must be accepted by the counterparty, not the proposer.
   */
  22: { message: "SettlementSelfAccept" },
  /**
   * A settlement proposal is already outstanding.
   */
  23: { message: "SettlementAlreadyProposed" },
  /**
   * A page size of zero, or larger than `MAX_PAGE_SIZE`, was requested.
   */
  24: { message: "InvalidPageSize" },
};

/**
 * A fully stored job.
 */
export interface Job {
  /**
   * The party funding the escrow. Only this address can approve payouts.
   */
  client: string;
  created_at: u64;
  /**
   * Unix timestamp after which `expire_job` may unwind the escrow.
   */
  deadline: u64;
  id: u64;
  milestones: Array<Milestone>;
  /**
   * Amount already transferred out to the worker.
   */
  released: i128;
  status: JobStatus;
  /**
   * SEP-41 token contract used for escrow (e.g. the native XLM SAC).
   */
  token: string;
  /**
   * Sum of all milestone amounts. Fixed at creation time.
   */
  total: i128;
  /**
   * `None` while the job is open, or the pre-assigned worker.
   */
  worker: Option<string>;
}

/**
 * Lifecycle of an escrowed job.
 *
 * Legal transitions (enforced in `lib.rs`):
 *
 * ```text
 * Open ──fund_job──▶ Funded ──accept_job──▶ InProgress ──all milestones paid──▶ Completed
 * │                   │                       │
 * │                   └──cancel_job──▶ Cancelled
 * │                                           ├──open_dispute──▶ Disputed
 * └────────────────── expire_job ───┐         │                     │
 * ▼         │      accept_settlement
 * Expired ◀────┘                     ▼
 * Completed
 * ```
 */
export type JobStatus =
  | { tag: "Open"; values: void }
  | { tag: "Funded"; values: void }
  | { tag: "InProgress"; values: void }
  | { tag: "Disputed"; values: void }
  | { tag: "Completed"; values: void }
  | { tag: "Cancelled"; values: void }
  | { tag: "Expired"; values: void };

/**
 * A milestone as stored on chain.
 */
export interface Milestone {
  /**
   * Amount of `Job::token` released to the worker when this milestone is
   * approved. Always strictly positive.
   */
  amount: i128;
  /**
   * SHA-256 of the deliverable (or of an IPFS CID / URL). The deliverable
   * itself is intentionally kept off chain; only this commitment is stored.
   * Zeroed until the milestone is submitted.
   */
  proof_hash: Buffer;
  status: MilestoneStatus;
  /**
   * Ledger timestamp of `submit_milestone`, or `0` while `Pending`.
   */
  submitted_at: u64;
  /**
   * Short human-readable label, e.g. "Design mockups". Bounded by
   * [`MAX_TITLE_LEN`].
   */
  title: string;
}

/**
 * A settlement proposal raised while a job is disputed.
 *
 * Settlement is the only mechanism that resolves a dispute, and it requires
 * the **counterparty** of the proposer to accept it. There is deliberately no
 * arbitrator or admin key that can move funds.
 */
export interface Settlement {
  /**
   * Portion of the escrowed balance that would be returned to the client.
   */
  client_amount: i128;
  /**
   * The party that proposed the split.
   */
  proposed_by: string;
  /**
   * Portion that would be paid to the worker: escrowed - `client_amount`.
   */
  worker_amount: i128;
}

/**
 * Input supplied by the client when creating a job.
 */
export interface MilestoneInput {
  amount: i128;
  title: string;
}

/**
 * Lifecycle of a single milestone.
 */
export type MilestoneStatus =
  | { tag: "Pending"; values: void }
  | { tag: "Submitted"; values: void }
  | { tag: "Approved"; values: void };

export interface Client {
  /**
   * Construct and simulate a get_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Fetch a single job.
   */
  get_job: (
    { job_id }: { job_id: u64 },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<Job>>>;

  /**
   * Construct and simulate a fund_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Move the client's full budget into the contract.
   *
   * Partial funding is intentionally not supported: a partially funded job
   * would make milestone payouts ambiguous, and it would let a client
   * occupy a worker with work it cannot pay for. The job must be `Open`.
   *
   * # Errors
   * - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
   */
  fund_job: (
    { job_id, client }: { job_id: u64; client: string },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_jobs transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Page over every job, newest-first is **not** guaranteed — ids ascend.
   */
  get_jobs: (
    { start, limit }: { start: u32; limit: u32 },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<Array<Job>>>>;

  /**
   * Construct and simulate a accept_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accept a job as `worker`.
   *
   * For an open job (`worker: None` at creation) the first caller wins. For
   * a reserved job only the pre-assigned address may accept. The worker must
   * be a different account from the client.
   *
   * # Errors
   * - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
   * - [`Error::Unauthorized`] — the job is reserved for a different account
   * - [`Error::ClientIsWorker`]
   */
  accept_job: (
    { job_id, worker }: { job_id: u64; worker: string },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a cancel_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancel a job and return the full escrow to the client.
   *
   * Only possible while the job is `Open` (nothing escrowed) or `Funded`
   * (escrowed, no worker has accepted). Once a worker has accepted, the
   * client can no longer unilaterally take the money back: it has to settle
   * a dispute or wait for `expire_job`.
   *
   * # Errors
   * - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
   */
  cancel_job: (
    { job_id, client }: { job_id: u64; client: string },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a create_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a job and return its id.
   *
   * The client signs this call. No funds move yet — call [`fund_job`]
   * afterwards. `worker` may be `Some` to reserve the job for a specific
   * account, or `None` to leave it open for any worker to accept.
   *
   * # Errors
   * - [`Error::NoMilestones`] / [`Error::TooManyMilestones`]
   * - [`Error::InvalidMilestoneAmount`] — a milestone amount was `<= 0`
   * - [`Error::TitleTooLong`]
   * - [`Error::ClientIsWorker`]
   * - [`Error::InvalidDeadline`] — the deadline is not in the future
   * - [`Error::Overflow`] — the milestone amounts summed past `i128::MAX`
   */
  create_job: (
    {
      client,
      worker,
      token,
      milestones,
      deadline,
    }: {
      client: string;
      worker: Option<string>;
      token: string;
      milestones: Array<MilestoneInput>;
      deadline: u64;
    },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<u64>>>;

  /**
   * Construct and simulate a expire_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Unwind an escrow whose deadline has passed. Callable by **anyone**.
   *
   * Payouts are fully deterministic, which is what makes a permissionless
   * trigger safe:
   * - milestones never delivered (`Pending`) are refunded to the client;
   * - milestones delivered before the deadline (`Submitted`) are paid to the
   * worker;
   * - milestones already paid are left alone.
   *
   * A dispute blocks this call. To avoid a permanent deadlock, either party
   * can `close_dispute` and then trigger expiry.
   *
   * # Errors
   * - [`Error::JobNotFound`]
   * - [`Error::InvalidJobStatus`] — already terminal, or disputed
   * - [`Error::DeadlineNotPassed`]
   */
  expire_job: (
    { job_id }: { job_id: u64 },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_escrowed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Value still held by the contract for this job.
   */
  get_escrowed: (
    { job_id }: { job_id: u64 },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<i128>>>;

  /**
   * Construct and simulate a open_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Freeze automated payouts and start a negotiation.
   *
   * Either party may open a dispute. While disputed, `expire_job` is blocked
   * and no milestone can be approved. Either party may `close_dispute` to
   * return to normal operation, so a dispute delays but never permanently
   * locks the escrow.
   *
   * # Errors
   * - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
   * - [`Error::Unauthorized`] — caller is neither client nor worker
   * - [`Error::ReasonTooLong`]
   */
  open_dispute: (
    { job_id, caller, reason }: { job_id: u64; caller: string; reason: string },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a close_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Close an open dispute and resume normal operation.
   *
   * Callable by either party; a stale or bad-faith dispute therefore cannot
   * trap the escrow indefinitely.
   */
  close_dispute: (
    { job_id, caller }: { job_id: u64; caller: string },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_job_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Total number of jobs ever created.
   */
  get_job_count: (
    options?: MethodOptions
  ) => Promise<AssembledTransaction<u64>>;

  /**
   * Construct and simulate a get_settlement transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The outstanding settlement proposal, if any.
   */
  get_settlement: (
    { job_id }: { job_id: u64 },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Option<Settlement>>>;

  /**
   * Construct and simulate a submit_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Submit proof for a milestone. Only the assigned worker may call this.
   *
   * `proof_hash` is a SHA-256 commitment to the deliverable (a hash of the
   * artifact, or of an IPFS CID / URL). The deliverable itself stays off
   * chain; the contract only anchors *that a specific artifact was
   * committed to at this ledger time*.
   *
   * # Errors
   * - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
   * - [`Error::NoWorker`] — nobody has accepted the job
   * - [`Error::Unauthorized`] — the caller is not the assigned worker
   * - [`Error::DeadlinePassed`]
   * - [`Error::InvalidMilestoneIndex`]
   * - [`Error::MilestoneAlreadyApproved`]
   */
  submit_milestone: (
    {
      job_id,
      index,
      worker,
      proof_hash,
    }: { job_id: u64; index: u32; worker: string; proof_hash: Buffer },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a accept_settlement transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accept the outstanding settlement proposal and move the funds.
   *
   * Only the counterparty of the proposer may accept. Executing pays the
   * client `client_amount` and the worker the remainder, then completes the
   * job. Because the contract holds the tokens, neither transfer can fail
   * for insufficient balance.
   *
   * # Errors
   * - [`Error::NoSettlement`]
   * - [`Error::SettlementSelfAccept`] — the proposer cannot accept its own terms
   * - [`Error::SettlementRequiresDispute`]
   */
  accept_settlement: (
    { job_id, acceptor }: { job_id: u64; acceptor: string },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a approve_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Approve a submitted milestone and pay the worker.
   *
   * Only the client may call this, and only a milestone that is actually
   * `Submitted` — a client cannot pay itself, and it cannot pay a milestone
   * that was never delivered.
   *
   * # Errors
   * - [`Error::JobNotFound`] / [`Error::InvalidJobStatus`]
   * - [`Error::InvalidMilestoneIndex`]
   * - [`Error::MilestoneNotSubmitted`] — nothing delivered yet
   * - [`Error::MilestoneAlreadyApproved`]
   */
  approve_milestone: (
    { job_id, index }: { job_id: u64; index: u32 },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a propose_settlement transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Propose how to split the remaining escrow. Only while disputed.
   *
   * `client_amount` is the part returned to the client; the worker receives
   * `escrowed - client_amount`. The counterparty must call
   * [`accept_settlement`] to execute it, so neither side can unilaterally
   * decide the split.
   *
   * # Errors
   * - [`Error::SettlementRequiresDispute`]
   * - [`Error::SettlementAlreadyProposed`]
   * - [`Error::SettlementExceedsBalance`] — `client_amount` outside `[0, escrowed]`
   * - [`Error::Unauthorized`]
   */
  propose_settlement: (
    {
      job_id,
      proposer,
      client_amount,
    }: { job_id: u64; proposer: string; client_amount: i128 },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_jobs_for_client transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Job ids created by `client`, paginated.
   */
  get_jobs_for_client: (
    { client, start, limit }: { client: string; start: u32; limit: u32 },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<Array<u64>>>>;

  /**
   * Construct and simulate a get_jobs_for_worker transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Job ids accepted by `worker`, paginated.
   */
  get_jobs_for_worker: (
    { worker, start, limit }: { worker: string; start: u32; limit: u32 },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<Array<u64>>>>;
}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([
        "AAAAAAAAABNGZXRjaCBhIHNpbmdsZSBqb2IuAAAAAAdnZXRfam9iAAAAAAEAAAAAAAAABmpvYl9pZAAAAAAABgAAAAEAAAPpAAAH0AAAAANKb2IAAAAAAw==",
        "AAAAAAAAAUBNb3ZlIHRoZSBjbGllbnQncyBmdWxsIGJ1ZGdldCBpbnRvIHRoZSBjb250cmFjdC4KClBhcnRpYWwgZnVuZGluZyBpcyBpbnRlbnRpb25hbGx5IG5vdCBzdXBwb3J0ZWQ6IGEgcGFydGlhbGx5IGZ1bmRlZCBqb2IKd291bGQgbWFrZSBtaWxlc3RvbmUgcGF5b3V0cyBhbWJpZ3VvdXMsIGFuZCBpdCB3b3VsZCBsZXQgYSBjbGllbnQKb2NjdXB5IGEgd29ya2VyIHdpdGggd29yayBpdCBjYW5ub3QgcGF5IGZvci4gVGhlIGpvYiBtdXN0IGJlIGBPcGVuYC4KCiMgRXJyb3JzCi0gW2BFcnJvcjo6Sm9iTm90Rm91bmRgXSAvIFtgRXJyb3I6OkludmFsaWRKb2JTdGF0dXNgXQAAAAhmdW5kX2pvYgAAAAIAAAAAAAAABmpvYl9pZAAAAAAABgAAAAAAAAAGY2xpZW50AAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAEdQYWdlIG92ZXIgZXZlcnkgam9iLCBuZXdlc3QtZmlyc3QgaXMgKipub3QqKiBndWFyYW50ZWVkIOKAlCBpZHMgYXNjZW5kLgAAAAAIZ2V0X2pvYnMAAAACAAAAAAAAAAVzdGFydAAAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPpAAAD6gAAB9AAAAADSm9iAAAAAAM=",
        "AAAAAAAAAXpBY2NlcHQgYSBqb2IgYXMgYHdvcmtlcmAuCgpGb3IgYW4gb3BlbiBqb2IgKGB3b3JrZXI6IE5vbmVgIGF0IGNyZWF0aW9uKSB0aGUgZmlyc3QgY2FsbGVyIHdpbnMuIEZvcgphIHJlc2VydmVkIGpvYiBvbmx5IHRoZSBwcmUtYXNzaWduZWQgYWRkcmVzcyBtYXkgYWNjZXB0LiBUaGUgd29ya2VyIG11c3QKYmUgYSBkaWZmZXJlbnQgYWNjb3VudCBmcm9tIHRoZSBjbGllbnQuCgojIEVycm9ycwotIFtgRXJyb3I6OkpvYk5vdEZvdW5kYF0gLyBbYEVycm9yOjpJbnZhbGlkSm9iU3RhdHVzYF0KLSBbYEVycm9yOjpVbmF1dGhvcml6ZWRgXSDigJQgdGhlIGpvYiBpcyByZXNlcnZlZCBmb3IgYSBkaWZmZXJlbnQgYWNjb3VudAotIFtgRXJyb3I6OkNsaWVudElzV29ya2VyYF0AAAAAAAphY2NlcHRfam9iAAAAAAACAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAAAAAAABndvcmtlcgAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAW1DYW5jZWwgYSBqb2IgYW5kIHJldHVybiB0aGUgZnVsbCBlc2Nyb3cgdG8gdGhlIGNsaWVudC4KCk9ubHkgcG9zc2libGUgd2hpbGUgdGhlIGpvYiBpcyBgT3BlbmAgKG5vdGhpbmcgZXNjcm93ZWQpIG9yIGBGdW5kZWRgCihlc2Nyb3dlZCwgbm8gd29ya2VyIGhhcyBhY2NlcHRlZCkuIE9uY2UgYSB3b3JrZXIgaGFzIGFjY2VwdGVkLCB0aGUKY2xpZW50IGNhbiBubyBsb25nZXIgdW5pbGF0ZXJhbGx5IHRha2UgdGhlIG1vbmV5IGJhY2s6IGl0IGhhcyB0byBzZXR0bGUKYSBkaXNwdXRlIG9yIHdhaXQgZm9yIGBleHBpcmVfam9iYC4KCiMgRXJyb3JzCi0gW2BFcnJvcjo6Sm9iTm90Rm91bmRgXSAvIFtgRXJyb3I6OkludmFsaWRKb2JTdGF0dXNgXQAAAAAAAApjYW5jZWxfam9iAAAAAAACAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAAAAAAABmNsaWVudAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAjFDcmVhdGUgYSBqb2IgYW5kIHJldHVybiBpdHMgaWQuCgpUaGUgY2xpZW50IHNpZ25zIHRoaXMgY2FsbC4gTm8gZnVuZHMgbW92ZSB5ZXQg4oCUIGNhbGwgW2BmdW5kX2pvYmBdCmFmdGVyd2FyZHMuIGB3b3JrZXJgIG1heSBiZSBgU29tZWAgdG8gcmVzZXJ2ZSB0aGUgam9iIGZvciBhIHNwZWNpZmljCmFjY291bnQsIG9yIGBOb25lYCB0byBsZWF2ZSBpdCBvcGVuIGZvciBhbnkgd29ya2VyIHRvIGFjY2VwdC4KCiMgRXJyb3JzCi0gW2BFcnJvcjo6Tm9NaWxlc3RvbmVzYF0gLyBbYEVycm9yOjpUb29NYW55TWlsZXN0b25lc2BdCi0gW2BFcnJvcjo6SW52YWxpZE1pbGVzdG9uZUFtb3VudGBdIOKAlCBhIG1pbGVzdG9uZSBhbW91bnQgd2FzIGA8PSAwYAotIFtgRXJyb3I6OlRpdGxlVG9vTG9uZ2BdCi0gW2BFcnJvcjo6Q2xpZW50SXNXb3JrZXJgXQotIFtgRXJyb3I6OkludmFsaWREZWFkbGluZWBdIOKAlCB0aGUgZGVhZGxpbmUgaXMgbm90IGluIHRoZSBmdXR1cmUKLSBbYEVycm9yOjpPdmVyZmxvd2BdIOKAlCB0aGUgbWlsZXN0b25lIGFtb3VudHMgc3VtbWVkIHBhc3QgYGkxMjg6Ok1BWGAAAAAAAAAKY3JlYXRlX2pvYgAAAAAABQAAAAAAAAAGY2xpZW50AAAAAAATAAAAAAAAAAZ3b3JrZXIAAAAAA+gAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAACm1pbGVzdG9uZXMAAAAAA+oAAAfQAAAADk1pbGVzdG9uZUlucHV0AAAAAAAAAAAACGRlYWRsaW5lAAAABgAAAAEAAAPpAAAABgAAAAM=",
        "AAAAAAAAAlBVbndpbmQgYW4gZXNjcm93IHdob3NlIGRlYWRsaW5lIGhhcyBwYXNzZWQuIENhbGxhYmxlIGJ5ICoqYW55b25lKiouCgpQYXlvdXRzIGFyZSBmdWxseSBkZXRlcm1pbmlzdGljLCB3aGljaCBpcyB3aGF0IG1ha2VzIGEgcGVybWlzc2lvbmxlc3MKdHJpZ2dlciBzYWZlOgotIG1pbGVzdG9uZXMgbmV2ZXIgZGVsaXZlcmVkIChgUGVuZGluZ2ApIGFyZSByZWZ1bmRlZCB0byB0aGUgY2xpZW50OwotIG1pbGVzdG9uZXMgZGVsaXZlcmVkIGJlZm9yZSB0aGUgZGVhZGxpbmUgKGBTdWJtaXR0ZWRgKSBhcmUgcGFpZCB0byB0aGUKd29ya2VyOwotIG1pbGVzdG9uZXMgYWxyZWFkeSBwYWlkIGFyZSBsZWZ0IGFsb25lLgoKQSBkaXNwdXRlIGJsb2NrcyB0aGlzIGNhbGwuIFRvIGF2b2lkIGEgcGVybWFuZW50IGRlYWRsb2NrLCBlaXRoZXIgcGFydHkKY2FuIGBjbG9zZV9kaXNwdXRlYCBhbmQgdGhlbiB0cmlnZ2VyIGV4cGlyeS4KCiMgRXJyb3JzCi0gW2BFcnJvcjo6Sm9iTm90Rm91bmRgXQotIFtgRXJyb3I6OkludmFsaWRKb2JTdGF0dXNgXSDigJQgYWxyZWFkeSB0ZXJtaW5hbCwgb3IgZGlzcHV0ZWQKLSBbYEVycm9yOjpEZWFkbGluZU5vdFBhc3NlZGBdAAAACmV4cGlyZV9qb2IAAAAAAAEAAAAAAAAABmpvYl9pZAAAAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAC5WYWx1ZSBzdGlsbCBoZWxkIGJ5IHRoZSBjb250cmFjdCBmb3IgdGhpcyBqb2IuAAAAAAAMZ2V0X2VzY3Jvd2VkAAAAAQAAAAAAAAAGam9iX2lkAAAAAAAGAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAbdGcmVlemUgYXV0b21hdGVkIHBheW91dHMgYW5kIHN0YXJ0IGEgbmVnb3RpYXRpb24uCgpFaXRoZXIgcGFydHkgbWF5IG9wZW4gYSBkaXNwdXRlLiBXaGlsZSBkaXNwdXRlZCwgYGV4cGlyZV9qb2JgIGlzIGJsb2NrZWQKYW5kIG5vIG1pbGVzdG9uZSBjYW4gYmUgYXBwcm92ZWQuIEVpdGhlciBwYXJ0eSBtYXkgYGNsb3NlX2Rpc3B1dGVgIHRvCnJldHVybiB0byBub3JtYWwgb3BlcmF0aW9uLCBzbyBhIGRpc3B1dGUgZGVsYXlzIGJ1dCBuZXZlciBwZXJtYW5lbnRseQpsb2NrcyB0aGUgZXNjcm93LgoKIyBFcnJvcnMKLSBbYEVycm9yOjpKb2JOb3RGb3VuZGBdIC8gW2BFcnJvcjo6SW52YWxpZEpvYlN0YXR1c2BdCi0gW2BFcnJvcjo6VW5hdXRob3JpemVkYF0g4oCUIGNhbGxlciBpcyBuZWl0aGVyIGNsaWVudCBub3Igd29ya2VyCi0gW2BFcnJvcjo6UmVhc29uVG9vTG9uZ2BdAAAAAAxvcGVuX2Rpc3B1dGUAAAADAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAGcmVhc29uAAAAAAAQAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAJlDbG9zZSBhbiBvcGVuIGRpc3B1dGUgYW5kIHJlc3VtZSBub3JtYWwgb3BlcmF0aW9uLgoKQ2FsbGFibGUgYnkgZWl0aGVyIHBhcnR5OyBhIHN0YWxlIG9yIGJhZC1mYWl0aCBkaXNwdXRlIHRoZXJlZm9yZSBjYW5ub3QKdHJhcCB0aGUgZXNjcm93IGluZGVmaW5pdGVseS4AAAAAAAANY2xvc2VfZGlzcHV0ZQAAAAAAAAIAAAAAAAAABmpvYl9pZAAAAAAABgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAACJUb3RhbCBudW1iZXIgb2Ygam9icyBldmVyIGNyZWF0ZWQuAAAAAAANZ2V0X2pvYl9jb3VudAAAAAAAAAAAAAABAAAABg==",
        "AAAAAAAAACxUaGUgb3V0c3RhbmRpbmcgc2V0dGxlbWVudCBwcm9wb3NhbCwgaWYgYW55LgAAAA5nZXRfc2V0dGxlbWVudAAAAAAAAQAAAAAAAAAGam9iX2lkAAAAAAAGAAAAAQAAA+gAAAfQAAAAClNldHRsZW1lbnQAAA==",
        "AAAAAAAAAlRTdWJtaXQgcHJvb2YgZm9yIGEgbWlsZXN0b25lLiBPbmx5IHRoZSBhc3NpZ25lZCB3b3JrZXIgbWF5IGNhbGwgdGhpcy4KCmBwcm9vZl9oYXNoYCBpcyBhIFNIQS0yNTYgY29tbWl0bWVudCB0byB0aGUgZGVsaXZlcmFibGUgKGEgaGFzaCBvZiB0aGUKYXJ0aWZhY3QsIG9yIG9mIGFuIElQRlMgQ0lEIC8gVVJMKS4gVGhlIGRlbGl2ZXJhYmxlIGl0c2VsZiBzdGF5cyBvZmYKY2hhaW47IHRoZSBjb250cmFjdCBvbmx5IGFuY2hvcnMgKnRoYXQgYSBzcGVjaWZpYyBhcnRpZmFjdCB3YXMKY29tbWl0dGVkIHRvIGF0IHRoaXMgbGVkZ2VyIHRpbWUqLgoKIyBFcnJvcnMKLSBbYEVycm9yOjpKb2JOb3RGb3VuZGBdIC8gW2BFcnJvcjo6SW52YWxpZEpvYlN0YXR1c2BdCi0gW2BFcnJvcjo6Tm9Xb3JrZXJgXSDigJQgbm9ib2R5IGhhcyBhY2NlcHRlZCB0aGUgam9iCi0gW2BFcnJvcjo6VW5hdXRob3JpemVkYF0g4oCUIHRoZSBjYWxsZXIgaXMgbm90IHRoZSBhc3NpZ25lZCB3b3JrZXIKLSBbYEVycm9yOjpEZWFkbGluZVBhc3NlZGBdCi0gW2BFcnJvcjo6SW52YWxpZE1pbGVzdG9uZUluZGV4YF0KLSBbYEVycm9yOjpNaWxlc3RvbmVBbHJlYWR5QXBwcm92ZWRgXQAAABBzdWJtaXRfbWlsZXN0b25lAAAABAAAAAAAAAAGam9iX2lkAAAAAAAGAAAAAAAAAAVpbmRleAAAAAAAAAQAAAAAAAAABndvcmtlcgAAAAAAEwAAAAAAAAAKcHJvb2ZfaGFzaAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAcZBY2NlcHQgdGhlIG91dHN0YW5kaW5nIHNldHRsZW1lbnQgcHJvcG9zYWwgYW5kIG1vdmUgdGhlIGZ1bmRzLgoKT25seSB0aGUgY291bnRlcnBhcnR5IG9mIHRoZSBwcm9wb3NlciBtYXkgYWNjZXB0LiBFeGVjdXRpbmcgcGF5cyB0aGUKY2xpZW50IGBjbGllbnRfYW1vdW50YCBhbmQgdGhlIHdvcmtlciB0aGUgcmVtYWluZGVyLCB0aGVuIGNvbXBsZXRlcyB0aGUKam9iLiBCZWNhdXNlIHRoZSBjb250cmFjdCBob2xkcyB0aGUgdG9rZW5zLCBuZWl0aGVyIHRyYW5zZmVyIGNhbiBmYWlsCmZvciBpbnN1ZmZpY2llbnQgYmFsYW5jZS4KCiMgRXJyb3JzCi0gW2BFcnJvcjo6Tm9TZXR0bGVtZW50YF0KLSBbYEVycm9yOjpTZXR0bGVtZW50U2VsZkFjY2VwdGBdIOKAlCB0aGUgcHJvcG9zZXIgY2Fubm90IGFjY2VwdCBpdHMgb3duIHRlcm1zCi0gW2BFcnJvcjo6U2V0dGxlbWVudFJlcXVpcmVzRGlzcHV0ZWBdAAAAAAARYWNjZXB0X3NldHRsZW1lbnQAAAAAAAACAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAAAAAAACGFjY2VwdG9yAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAaJBcHByb3ZlIGEgc3VibWl0dGVkIG1pbGVzdG9uZSBhbmQgcGF5IHRoZSB3b3JrZXIuCgpPbmx5IHRoZSBjbGllbnQgbWF5IGNhbGwgdGhpcywgYW5kIG9ubHkgYSBtaWxlc3RvbmUgdGhhdCBpcyBhY3R1YWxseQpgU3VibWl0dGVkYCDigJQgYSBjbGllbnQgY2Fubm90IHBheSBpdHNlbGYsIGFuZCBpdCBjYW5ub3QgcGF5IGEgbWlsZXN0b25lCnRoYXQgd2FzIG5ldmVyIGRlbGl2ZXJlZC4KCiMgRXJyb3JzCi0gW2BFcnJvcjo6Sm9iTm90Rm91bmRgXSAvIFtgRXJyb3I6OkludmFsaWRKb2JTdGF0dXNgXQotIFtgRXJyb3I6OkludmFsaWRNaWxlc3RvbmVJbmRleGBdCi0gW2BFcnJvcjo6TWlsZXN0b25lTm90U3VibWl0dGVkYF0g4oCUIG5vdGhpbmcgZGVsaXZlcmVkIHlldAotIFtgRXJyb3I6Ok1pbGVzdG9uZUFscmVhZHlBcHByb3ZlZGBdAAAAAAARYXBwcm92ZV9taWxlc3RvbmUAAAAAAAACAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAAAAAAABWluZGV4AAAAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAdtQcm9wb3NlIGhvdyB0byBzcGxpdCB0aGUgcmVtYWluaW5nIGVzY3Jvdy4gT25seSB3aGlsZSBkaXNwdXRlZC4KCmBjbGllbnRfYW1vdW50YCBpcyB0aGUgcGFydCByZXR1cm5lZCB0byB0aGUgY2xpZW50OyB0aGUgd29ya2VyIHJlY2VpdmVzCmBlc2Nyb3dlZCAtIGNsaWVudF9hbW91bnRgLiBUaGUgY291bnRlcnBhcnR5IG11c3QgY2FsbApbYGFjY2VwdF9zZXR0bGVtZW50YF0gdG8gZXhlY3V0ZSBpdCwgc28gbmVpdGhlciBzaWRlIGNhbiB1bmlsYXRlcmFsbHkKZGVjaWRlIHRoZSBzcGxpdC4KCiMgRXJyb3JzCi0gW2BFcnJvcjo6U2V0dGxlbWVudFJlcXVpcmVzRGlzcHV0ZWBdCi0gW2BFcnJvcjo6U2V0dGxlbWVudEFscmVhZHlQcm9wb3NlZGBdCi0gW2BFcnJvcjo6U2V0dGxlbWVudEV4Y2VlZHNCYWxhbmNlYF0g4oCUIGBjbGllbnRfYW1vdW50YCBvdXRzaWRlIGBbMCwgZXNjcm93ZWRdYAotIFtgRXJyb3I6OlVuYXV0aG9yaXplZGBdAAAAABJwcm9wb3NlX3NldHRsZW1lbnQAAAAAAAMAAAAAAAAABmpvYl9pZAAAAAAABgAAAAAAAAAIcHJvcG9zZXIAAAATAAAAAAAAAA1jbGllbnRfYW1vdW50AAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAACdKb2IgaWRzIGNyZWF0ZWQgYnkgYGNsaWVudGAsIHBhZ2luYXRlZC4AAAAAE2dldF9qb2JzX2Zvcl9jbGllbnQAAAAAAwAAAAAAAAAGY2xpZW50AAAAAAATAAAAAAAAAAVzdGFydAAAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPpAAAD6gAAAAYAAAAD",
        "AAAAAAAAAChKb2IgaWRzIGFjY2VwdGVkIGJ5IGB3b3JrZXJgLCBwYWdpbmF0ZWQuAAAAE2dldF9qb2JzX2Zvcl93b3JrZXIAAAAAAwAAAAAAAAAGd29ya2VyAAAAAAATAAAAAAAAAAVzdGFydAAAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPpAAAD6gAAAAYAAAAD",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAGAAAACVUaGUgcmVmZXJlbmNlZCBqb2IgaWQgZG9lcyBub3QgZXhpc3QuAAAAAAAAC0pvYk5vdEZvdW5kAAAAAAEAAAA8VGhlIGpvYiBpcyBub3QgaW4gdGhlIHN0YXRlIHJlcXVpcmVkIGJ5IHRoZSBjYWxsZWQgZnVuY3Rpb24uAAAAEEludmFsaWRKb2JTdGF0dXMAAAACAAAAMEEgbWlsZXN0b25lIGluZGV4IHdhcyBvdXQgb2YgcmFuZ2UgZm9yIHRoaXMgam9iLgAAABVJbnZhbGlkTWlsZXN0b25lSW5kZXgAAAAAAAADAAAAKEEgbWlsZXN0b25lIGFtb3VudCB3YXMgemVybyBvciBuZWdhdGl2ZS4AAAAWSW52YWxpZE1pbGVzdG9uZUFtb3VudAAAAAAABAAAAClBIGpvYiBtdXN0IGRlZmluZSBhdCBsZWFzdCBvbmUgbWlsZXN0b25lLgAAAAAAAAxOb01pbGVzdG9uZXMAAAAFAAAANEEgam9iIGRlZmluZWQgbW9yZSBtaWxlc3RvbmVzIHRoYW4gYE1BWF9NSUxFU1RPTkVTYC4AAAARVG9vTWFueU1pbGVzdG9uZXMAAAAAAAAGAAAAPVRoZSBkZWFkbGluZSBpcyBub3QgaW4gdGhlIGZ1dHVyZSAoY2hlY2tlZCBhdCBjcmVhdGlvbiB0aW1lKS4AAAAAAAAPSW52YWxpZERlYWRsaW5lAAAAAAcAAAAkVGhlIGpvYiBkZWFkbGluZSBoYXMgbm90IHBhc3NlZCB5ZXQuAAAAEURlYWRsaW5lTm90UGFzc2VkAAAAAAAACAAAAEFUaGUgam9iIGRlYWRsaW5lIGhhcyBwYXNzZWQ7IG5ldyB3b3JrIGNhbiBubyBsb25nZXIgYmUgc3VibWl0dGVkLgAAAAAAAA5EZWFkbGluZVBhc3NlZAAAAAAACQAAADRUaGUgY2FsbGVyIGlzIG5vdCBhdXRob3Jpc2VkIHRvIHBlcmZvcm0gdGhpcyBhY3Rpb24uAAAADFVuYXV0aG9yaXplZAAAAAoAAAApVGhlIGNhbGxlciBpcyBub3QgdGhlIHdvcmtlciBvZiB0aGlzIGpvYi4AAAAAAAAJTm90V29ya2VyAAAAAAAACwAAACNUaGUgam9iIGhhcyBubyB3b3JrZXIgYXNzaWduZWQgeWV0LgAAAAAITm9Xb3JrZXIAAAAMAAAANVRoZSBjbGllbnQgYW5kIHRoZSB3b3JrZXIgbXVzdCBiZSBkaWZmZXJlbnQgYWNjb3VudHMuAAAAAAAADkNsaWVudElzV29ya2VyAAAAAAANAAAAMUEgbWlsZXN0b25lIHRpdGxlIGV4Y2VlZGVkIGBNQVhfVElUTEVfTEVOYCBieXRlcy4AAAAAAAAMVGl0bGVUb29Mb25nAAAADgAAADFBIGRpc3B1dGUgcmVhc29uIGV4Y2VlZGVkIGBNQVhfUkVBU09OX0xFTmAgYnl0ZXMuAAAAAAAADVJlYXNvblRvb0xvbmcAAAAAAAAPAAAAKkEgY2hlY2tlZCBhcml0aG1ldGljIG9wZXJhdGlvbiBvdmVyZmxvd2VkLgAAAAAACE92ZXJmbG93AAAAEAAAAEBUaGUgbWlsZXN0b25lIGhhcyBub3QgYmVlbiBzdWJtaXR0ZWQgYW5kIGNhbm5vdCBiZSBhcHByb3ZlZCB5ZXQuAAAAFU1pbGVzdG9uZU5vdFN1Ym1pdHRlZAAAAAAAABEAAAAoVGhlIG1pbGVzdG9uZSBoYXMgYWxyZWFkeSBiZWVuIHBhaWQgb3V0LgAAABhNaWxlc3RvbmVBbHJlYWR5QXBwcm92ZWQAAAASAAAAP1RoZSBqb2IgbXVzdCBiZSBpbiBkaXNwdXRlIGJlZm9yZSBhIHNldHRsZW1lbnQgY2FuIGJlIHByb3Bvc2VkLgAAAAAZU2V0dGxlbWVudFJlcXVpcmVzRGlzcHV0ZQAAAAAAABMAAAAwTm8gc2V0dGxlbWVudCBwcm9wb3NhbCBpcyBjdXJyZW50bHkgb3V0c3RhbmRpbmcuAAAADE5vU2V0dGxlbWVudAAAABQAAAA+VGhlIHByb3Bvc2VkIGNsaWVudCBzaGFyZSBpcyBsYXJnZXIgdGhhbiB0aGUgZXNjcm93ZWQgYmFsYW5jZS4AAAAAABhTZXR0bGVtZW50RXhjZWVkc0JhbGFuY2UAAAAVAAAAREEgc2V0dGxlbWVudCBtdXN0IGJlIGFjY2VwdGVkIGJ5IHRoZSBjb3VudGVycGFydHksIG5vdCB0aGUgcHJvcG9zZXIuAAAAFFNldHRsZW1lbnRTZWxmQWNjZXB0AAAAFgAAAC1BIHNldHRsZW1lbnQgcHJvcG9zYWwgaXMgYWxyZWFkeSBvdXRzdGFuZGluZy4AAAAAAAAZU2V0dGxlbWVudEFscmVhZHlQcm9wb3NlZAAAAAAAABcAAABDQSBwYWdlIHNpemUgb2YgemVybywgb3IgbGFyZ2VyIHRoYW4gYE1BWF9QQUdFX1NJWkVgLCB3YXMgcmVxdWVzdGVkLgAAAAAPSW52YWxpZFBhZ2VTaXplAAAAABg=",
        "AAAAAQAAABNBIGZ1bGx5IHN0b3JlZCBqb2IuAAAAAAAAAAADSm9iAAAAAAoAAABEVGhlIHBhcnR5IGZ1bmRpbmcgdGhlIGVzY3Jvdy4gT25seSB0aGlzIGFkZHJlc3MgY2FuIGFwcHJvdmUgcGF5b3V0cy4AAAAGY2xpZW50AAAAAAATAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAPlVuaXggdGltZXN0YW1wIGFmdGVyIHdoaWNoIGBleHBpcmVfam9iYCBtYXkgdW53aW5kIHRoZSBlc2Nyb3cuAAAAAAAIZGVhZGxpbmUAAAAGAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAKbWlsZXN0b25lcwAAAAAD6gAAB9AAAAAJTWlsZXN0b25lAAAAAAAALUFtb3VudCBhbHJlYWR5IHRyYW5zZmVycmVkIG91dCB0byB0aGUgd29ya2VyLgAAAAAAAAhyZWxlYXNlZAAAAAsAAAAAAAAABnN0YXR1cwAAAAAH0AAAAAlKb2JTdGF0dXMAAAAAAABAU0VQLTQxIHRva2VuIGNvbnRyYWN0IHVzZWQgZm9yIGVzY3JvdyAoZS5nLiB0aGUgbmF0aXZlIFhMTSBTQUMpLgAAAAV0b2tlbgAAAAAAABMAAAA1U3VtIG9mIGFsbCBtaWxlc3RvbmUgYW1vdW50cy4gRml4ZWQgYXQgY3JlYXRpb24gdGltZS4AAAAAAAAFdG90YWwAAAAAAAALAAAAOWBOb25lYCB3aGlsZSB0aGUgam9iIGlzIG9wZW4sIG9yIHRoZSBwcmUtYXNzaWduZWQgd29ya2VyLgAAAAAAAAZ3b3JrZXIAAAAAA+gAAAAT",
        "AAAAAgAAAmxMaWZlY3ljbGUgb2YgYW4gZXNjcm93ZWQgam9iLgoKTGVnYWwgdHJhbnNpdGlvbnMgKGVuZm9yY2VkIGluIGBsaWIucnNgKToKCmBgYHRleHQKT3BlbiDilIDilIBmdW5kX2pvYuKUgOKUgOKWtiBGdW5kZWQg4pSA4pSAYWNjZXB0X2pvYuKUgOKUgOKWtiBJblByb2dyZXNzIOKUgOKUgGFsbCBtaWxlc3RvbmVzIHBhaWTilIDilIDilrYgQ29tcGxldGVkCuKUgiAgICAgICAgICAgICAgICAgICDilIIgICAgICAgICAgICAgICAgICAgICAgIOKUggrilIIgICAgICAgICAgICAgICAgICAg4pSU4pSA4pSAY2FuY2VsX2pvYuKUgOKUgOKWtiBDYW5jZWxsZWQK4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUnOKUgOKUgG9wZW5fZGlzcHV0ZeKUgOKUgOKWtiBEaXNwdXRlZArilJTilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgZXhwaXJlX2pvYiDilIDilIDilIDilJAgICAgICAgICDilIIgICAgICAgICAgICAgICAgICAgICDilIIK4pa8ICAgICAgICAg4pSCICAgICAgYWNjZXB0X3NldHRsZW1lbnQKRXhwaXJlZCDil4DilIDilIDilIDilIDilJggICAgICAgICAgICAgICAgICAgICDilrwKQ29tcGxldGVkCmBgYAAAAAAAAAAJSm9iU3RhdHVzAAAAAAAABwAAAAAAAAA6Q3JlYXRlZCBieSB0aGUgY2xpZW50LCBubyBmdW5kcyBlc2Nyb3dlZCB5ZXQuIE5vdCBwYXlhYmxlLgAAAAAABE9wZW4AAAAAAAAARlRoZSBjbGllbnQncyBmdWxsIGJ1ZGdldCBpcyBoZWxkIGJ5IHRoZSBjb250cmFjdC4gQXdhaXRzIGBhY2NlcHRfam9iYC4AAAAAAAZGdW5kZWQAAAAAAAAAAAA6QSB3b3JrZXIgaGFzIGFjY2VwdGVkLiBXb3JrIG1heSBiZSBzdWJtaXR0ZWQgYW5kIHBhaWQgb3V0LgAAAAAACkluUHJvZ3Jlc3MAAAAAAAAAAAB1QSBwYXJ0eSByYWlzZWQgYSBkaXNwdXRlLiBBdXRvbWF0ZWQgcGF5b3V0cyBhcmUgZnJvemVuIHVudGlsIHRoZQpkaXNwdXRlIGlzIGNsb3NlZCBvciB0aGUgcGFydGllcyBhZ3JlZSBhIHNldHRsZW1lbnQuAAAAAAAACERpc3B1dGVkAAAAAAAAAChFdmVyeSBtaWxlc3RvbmUgaGFzIGJlZW4gcGFpZC4gVGVybWluYWwuAAAACUNvbXBsZXRlZAAAAAAAAAAAAABNQ2FuY2VsbGVkIGJ5IHRoZSBjbGllbnQgYmVmb3JlIHRoZSB3b3JrZXIgYWNjZXB0ZWQuIEZ1bmRzIHJldHVybmVkLiBUZXJtaW5hbC4AAAAAAAAJQ2FuY2VsbGVkAAAAAAAAAAAAADlUaGUgZGVhZGxpbmUgcGFzc2VkIGFuZCB0aGUgZXNjcm93IHdhcyB1bndvdW5kLiBUZXJtaW5hbC4AAAAAAAAHRXhwaXJlZAA=",
        "AAAAAQAAAB9BIG1pbGVzdG9uZSBhcyBzdG9yZWQgb24gY2hhaW4uAAAAAAAAAAAJTWlsZXN0b25lAAAAAAAABQAAAGhBbW91bnQgb2YgYEpvYjo6dG9rZW5gIHJlbGVhc2VkIHRvIHRoZSB3b3JrZXIgd2hlbiB0aGlzIG1pbGVzdG9uZSBpcwphcHByb3ZlZC4gQWx3YXlzIHN0cmljdGx5IHBvc2l0aXZlLgAAAAZhbW91bnQAAAAAAAsAAAC2U0hBLTI1NiBvZiB0aGUgZGVsaXZlcmFibGUgKG9yIG9mIGFuIElQRlMgQ0lEIC8gVVJMKS4gVGhlIGRlbGl2ZXJhYmxlCml0c2VsZiBpcyBpbnRlbnRpb25hbGx5IGtlcHQgb2ZmIGNoYWluOyBvbmx5IHRoaXMgY29tbWl0bWVudCBpcyBzdG9yZWQuClplcm9lZCB1bnRpbCB0aGUgbWlsZXN0b25lIGlzIHN1Ym1pdHRlZC4AAAAAAApwcm9vZl9oYXNoAAAAAAPuAAAAIAAAAAAAAAAGc3RhdHVzAAAAAAfQAAAAD01pbGVzdG9uZVN0YXR1cwAAAAA/TGVkZ2VyIHRpbWVzdGFtcCBvZiBgc3VibWl0X21pbGVzdG9uZWAsIG9yIGAwYCB3aGlsZSBgUGVuZGluZ2AuAAAAAAxzdWJtaXR0ZWRfYXQAAAAGAAAAUFNob3J0IGh1bWFuLXJlYWRhYmxlIGxhYmVsLCBlLmcuICJEZXNpZ24gbW9ja3VwcyIuIEJvdW5kZWQgYnkKW2BNQVhfVElUTEVfTEVOYF0uAAAABXRpdGxlAAAAAAAAEA==",
        "AAAAAQAAAPlBIHNldHRsZW1lbnQgcHJvcG9zYWwgcmFpc2VkIHdoaWxlIGEgam9iIGlzIGRpc3B1dGVkLgoKU2V0dGxlbWVudCBpcyB0aGUgb25seSBtZWNoYW5pc20gdGhhdCByZXNvbHZlcyBhIGRpc3B1dGUsIGFuZCBpdCByZXF1aXJlcwp0aGUgKipjb3VudGVycGFydHkqKiBvZiB0aGUgcHJvcG9zZXIgdG8gYWNjZXB0IGl0LiBUaGVyZSBpcyBkZWxpYmVyYXRlbHkgbm8KYXJiaXRyYXRvciBvciBhZG1pbiBrZXkgdGhhdCBjYW4gbW92ZSBmdW5kcy4AAAAAAAAAAAAAClNldHRsZW1lbnQAAAAAAAMAAABFUG9ydGlvbiBvZiB0aGUgZXNjcm93ZWQgYmFsYW5jZSB0aGF0IHdvdWxkIGJlIHJldHVybmVkIHRvIHRoZSBjbGllbnQuAAAAAAAADWNsaWVudF9hbW91bnQAAAAAAAALAAAAIlRoZSBwYXJ0eSB0aGF0IHByb3Bvc2VkIHRoZSBzcGxpdC4AAAAAAAtwcm9wb3NlZF9ieQAAAAATAAAARVBvcnRpb24gdGhhdCB3b3VsZCBiZSBwYWlkIHRvIHRoZSB3b3JrZXI6IGVzY3Jvd2VkIC0gYGNsaWVudF9hbW91bnRgLgAAAAAAAA13b3JrZXJfYW1vdW50AAAAAAAACw==",
        "AAAAAQAAADFJbnB1dCBzdXBwbGllZCBieSB0aGUgY2xpZW50IHdoZW4gY3JlYXRpbmcgYSBqb2IuAAAAAAAAAAAAAA5NaWxlc3RvbmVJbnB1dAAAAAAAAgAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAV0aXRsZQAAAAAAABA=",
        "AAAAAgAAACBMaWZlY3ljbGUgb2YgYSBzaW5nbGUgbWlsZXN0b25lLgAAAAAAAAAPTWlsZXN0b25lU3RhdHVzAAAAAAMAAAAAAAAASk5vdCB5ZXQgZGVsaXZlcmVkLiBUaGUgZXNjcm93ZWQgYW1vdW50IGZvciBpdCBpcyByZWZ1bmRhYmxlIHRvIHRoZSBjbGllbnQuAAAAAAAHUGVuZGluZwAAAAAAAAAAR1RoZSB3b3JrZXIgc3VibWl0dGVkIHByb29mIGJlZm9yZSB0aGUgZGVhZGxpbmUuIEF3YWl0aW5nIGNsaWVudCByZXZpZXcuAAAAAAlTdWJtaXR0ZWQAAAAAAAAAAAAAHVBhaWQgdG8gdGhlIHdvcmtlci4gVGVybWluYWwuAAAAAAAACEFwcHJvdmVk",
        "AAAABQAAADhFbWl0dGVkIHdoZW5ldmVyIGZ1bmRzIGxlYXZlIHRoZSBlc2Nyb3csIGZvciBhbnkgcmVhc29uLgAAAAAAAAAEUGFpZAAAAAIAAAAGZXNjcm93AAAAAAAEcGFpZAAAAAQAAAAAAAAAAnRvAAAAAAATAAAAAQAAAAAAAAAGam9iX2lkAAAAAAAGAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAEhgU29tZShpbmRleClgIGZvciBhIG1pbGVzdG9uZSBwYXlvdXQsIGBOb25lYCBmb3IgYSByZWZ1bmQgb3Igc2V0dGxlbWVudC4AAAAJbWlsZXN0b25lAAAAAAAD6AAAAAQAAAAAAAAAAg==",
        "AAAABQAAABZFbWl0dGVkIGJ5IGBmdW5kX2pvYmAuAAAAAAAAAAAACUpvYkZ1bmRlZAAAAAAAAAIAAAAGZXNjcm93AAAAAAAIam9iX2Z1bmQAAAADAAAAAAAAAAZjbGllbnQAAAAAABMAAAABAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAABAAAALUFtb3VudCBub3cgaGVsZCBieSB0aGUgY29udHJhY3QgZm9yIHRoaXMgam9iLgAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAABhFbWl0dGVkIGJ5IGBjcmVhdGVfam9iYC4AAAAAAAAACkpvYkNyZWF0ZWQAAAAAAAIAAAAGZXNjcm93AAAAAAAHam9iX25ldwAAAAAEAAAAJlRoZSBhY2NvdW50IHRoYXQgd2lsbCBmdW5kIHRoZSBlc2Nyb3cuAAAAAAAGY2xpZW50AAAAAAATAAAAAQAAAAAAAAAGam9iX2lkAAAAAAAGAAAAAQAAAERQcmUtYXNzaWduZWQgd29ya2VyLCBpZiB0aGUgam9iIHdhcyByZXNlcnZlZCBmb3IgYSBzcGVjaWZpYyBhY2NvdW50LgAAAAZ3b3JrZXIAAAAAA+gAAAATAAAAAAAAABxUb3RhbCBidWRnZXQgdG8gYmUgZXNjcm93ZWQuAAAABXRvdGFsAAAAAAAACwAAAAAAAAAC",
        "AAAABQAAABhFbWl0dGVkIGJ5IGBleHBpcmVfam9iYC4AAAAAAAAACkpvYkV4cGlyZWQAAAAAAAIAAAAGZXNjcm93AAAAAAAHam9iX2V4cAAAAAADAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAAAAAAAAAAAAAhyZWZ1bmRlZAAAAAsAAAAAAAAAAAAAAAhyZWxlYXNlZAAAAAsAAAAAAAAAAg==",
        "AAAABQAAABhFbWl0dGVkIGJ5IGBhY2NlcHRfam9iYC4AAAAAAAAAC0pvYkFjY2VwdGVkAAAAAAIAAAAGZXNjcm93AAAAAAAIam9iX3Rha2UAAAACAAAAAAAAAAZ3b3JrZXIAAAAAABMAAAABAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAABAAAAAg==",
        "AAAABQAAABhFbWl0dGVkIGJ5IGBjYW5jZWxfam9iYC4AAAAAAAAADEpvYkNhbmNlbGxlZAAAAAIAAAAGZXNjcm93AAAAAAAIam9iX2NuY2wAAAACAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAAAAAAAAAAAAAhyZWZ1bmRlZAAAAAsAAAAAAAAAAg==",
        "AAAABQAAADtFbWl0dGVkIHdoZW4gYSBqb2IgcmVhY2hlcyBhIHRlcm1pbmFsLCBmdWxseSBzZXR0bGVkIHN0YXRlLgAAAAAAAAAADEpvYkNvbXBsZXRlZAAAAAIAAAAGZXNjcm93AAAAAAAIam9iX2RvbmUAAAACAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAAAAAAAAAAAAAhyZWxlYXNlZAAAAAsAAAAAAAAAAg==",
        "AAAABQAAABtFbWl0dGVkIGJ5IGBjbG9zZV9kaXNwdXRlYC4AAAAAAAAAAA1EaXNwdXRlQ2xvc2VkAAAAAAAAAgAAAAZlc2Nyb3cAAAAAAAlkaXNwdXRlX3gAAAAAAAABAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAAAAAAAAg==",
        "AAAABQAAABpFbWl0dGVkIGJ5IGBvcGVuX2Rpc3B1dGVgLgAAAAAAAAAAAA1EaXNwdXRlT3BlbmVkAAAAAAAAAgAAAAZlc2Nyb3cAAAAAAAdkaXNwdXRlAAAAAAIAAAAAAAAACW9wZW5lZF9ieQAAAAAAABMAAAABAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAABAAAAAg==",
        "AAAABQAAAB5FbWl0dGVkIGJ5IGBzdWJtaXRfbWlsZXN0b25lYC4AAAAAAAAAAAASTWlsZXN0b25lU3VibWl0dGVkAAAAAAACAAAABmVzY3JvdwAAAAAACW1zX3N1Ym1pdAAAAAAAAAMAAAAAAAAABndvcmtlcgAAAAAAEwAAAAEAAAAAAAAABmpvYl9pZAAAAAAABgAAAAEAAAAAAAAABWluZGV4AAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAEBFbWl0dGVkIGJ5IGBhY2NlcHRfc2V0dGxlbWVudGAgb25jZSB0aGUgc3BsaXQgaGFzIGJlZW4gcGFpZCBvdXQuAAAAAAAAABJTZXR0bGVtZW50QWNjZXB0ZWQAAAAAAAIAAAAGZXNjcm93AAAAAAAJc2V0dGxlX29rAAAAAAAAAwAAAAAAAAAGam9iX2lkAAAAAAAGAAAAAAAAAAAAAAANY2xpZW50X2Ftb3VudAAAAAAAAAsAAAAAAAAAAAAAAA13b3JrZXJfYW1vdW50AAAAAAAACwAAAAAAAAAC",
        "AAAABQAAACBFbWl0dGVkIGJ5IGBwcm9wb3NlX3NldHRsZW1lbnRgLgAAAAAAAAASU2V0dGxlbWVudFByb3Bvc2VkAAAAAAACAAAABmVzY3JvdwAAAAAABnNldHRsZQAAAAAABAAAAAAAAAACYnkAAAAAABMAAAABAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAABAAAAAAAAAA1jbGllbnRfYW1vdW50AAAAAAAACwAAAAAAAAAAAAAADXdvcmtlcl9hbW91bnQAAAAAAAALAAAAAAAAAAI=",
      ]),
      options
    );
  }
  public readonly fromJSON = {
    get_job: this.txFromJSON<Result<Job>>,
    fund_job: this.txFromJSON<Result<void>>,
    get_jobs: this.txFromJSON<Result<Array<Job>>>,
    accept_job: this.txFromJSON<Result<void>>,
    cancel_job: this.txFromJSON<Result<void>>,
    create_job: this.txFromJSON<Result<u64>>,
    expire_job: this.txFromJSON<Result<void>>,
    get_escrowed: this.txFromJSON<Result<i128>>,
    open_dispute: this.txFromJSON<Result<void>>,
    close_dispute: this.txFromJSON<Result<void>>,
    get_job_count: this.txFromJSON<u64>,
    get_settlement: this.txFromJSON<Option<Settlement>>,
    submit_milestone: this.txFromJSON<Result<void>>,
    accept_settlement: this.txFromJSON<Result<void>>,
    approve_milestone: this.txFromJSON<Result<void>>,
    propose_settlement: this.txFromJSON<Result<void>>,
    get_jobs_for_client: this.txFromJSON<Result<Array<u64>>>,
    get_jobs_for_worker: this.txFromJSON<Result<Array<u64>>>,
  };
}
