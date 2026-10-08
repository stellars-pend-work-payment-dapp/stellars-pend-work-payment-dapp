import { Errors } from "@spg/escrow";

/**
 * Turns contract, wallet and network failures into something a user can act on.
 *
 * A contract rejection surfaces from the Soroban RPC as diagnostic text such as
 * `HostError: Error(Contract, #2)` or as the error name (for example
 * `InvalidJobStatus`) depending on where in the pipeline it is raised, so both
 * forms are matched.
 */

const BY_CODE: Record<number, string> = {
  1: "That job does not exist on this contract.",
  2: "This job is not in the right state for that action. Refresh to see the latest state.",
  3: "That milestone does not exist on this job.",
  4: "A milestone amount must be greater than zero.",
  5: "A job must have at least one milestone.",
  6: "A job can have at most 20 milestones.",
  7: "The deadline must be in the future.",
  8: "The deadline has not passed yet.",
  9: "The deadline has passed — work can no longer be submitted. The escrow can now be wound up.",
  10: "Your connected wallet is not authorised to do that on this job.",
  11: "Only the assigned worker can do that.",
  12: "No worker has accepted this job yet.",
  13: "The client and the worker must be different accounts.",
  14: "That milestone title is too long (max 64 characters).",
  15: "That dispute reason is too long (max 256 characters).",
  16: "The amounts were too large to total safely.",
  17: "That milestone has not been submitted yet, so it cannot be approved.",
  18: "That milestone has already been paid.",
  19: "A settlement can only be proposed while the job is disputed.",
  20: "There is no settlement proposal to accept.",
  21: "The proposed client share is larger than the amount still in escrow.",
  22: "The counterparty must accept a settlement — you cannot accept your own proposal.",
  23: "A settlement proposal is already awaiting the other party's response.",
  24: "Requested page size is invalid.",
};

const BY_NAME: Record<string, string> = {
  JobNotFound: BY_CODE[1],
  InvalidJobStatus: BY_CODE[2],
  InvalidMilestoneIndex: BY_CODE[3],
  InvalidMilestoneAmount: BY_CODE[4],
  NoMilestones: BY_CODE[5],
  TooManyMilestones: BY_CODE[6],
  InvalidDeadline: BY_CODE[7],
  DeadlineNotPassed: BY_CODE[8],
  DeadlinePassed: BY_CODE[9],
  Unauthorized: BY_CODE[10],
  NotWorker: BY_CODE[11],
  NoWorker: BY_CODE[12],
  ClientIsWorker: BY_CODE[13],
  TitleTooLong: BY_CODE[14],
  ReasonTooLong: BY_CODE[15],
  Overflow: BY_CODE[16],
  MilestoneNotSubmitted: BY_CODE[17],
  MilestoneAlreadyApproved: BY_CODE[18],
  SettlementRequiresDispute: BY_CODE[19],
  NoSettlement: BY_CODE[20],
  SettlementExceedsBalance: BY_CODE[21],
  SettlementSelfAccept: BY_CODE[22],
  SettlementAlreadyProposed: BY_CODE[23],
  InvalidPageSize: BY_CODE[24],
};

/** Contract error names, longest first so `NoWorker` cannot shadow `NotWorker`. */
const ERROR_NAMES = Object.keys(BY_NAME).sort((a, b) => b.length - a.length);

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error === "string") return candidate.error;
  }
  return "";
}

/** Wallet-level failures worth their own wording. */
function describeWalletError(message: string): string | null {
  const text = message.toLowerCase();
  if (
    text.includes("user declined") ||
    text.includes("user rejected") ||
    text.includes("denied")
  )
    return "You rejected the request in your wallet.";
  if (text.includes("not connected") || text.includes("connect"))
    return "Connect a Stellar wallet first.";
  if (
    text.includes("insufficient") ||
    text.includes("balance is not sufficient")
  )
    return "Your wallet does not have enough XLM to cover this transaction.";
  if (text.includes("timeout") || text.includes("timed out"))
    return "The network did not confirm the transaction in time. Check the transaction link before retrying.";
  if (text.includes("failed to fetch") || text.includes("networkerror"))
    return "Could not reach the Stellar network. Check your connection and try again.";
  return null;
}

/**
 * Best-effort human-readable message for any escrow failure.
 *
 * Falls back to the raw message rather than hiding it — a reviewer (or a bug
 * report) is better served by the real error than by a generic apology.
 */
export function describeEscrowError(error: unknown): string {
  const message = extractMessage(error);

  const wallet = describeWalletError(message);
  if (wallet) return wallet;

  // `Error(Contract, #12)`
  const coded = /Error\(Contract,\s*#(\d+)\)/i.exec(message);
  if (coded) {
    const advice = BY_CODE[Number(coded[1])];
    if (advice) return advice;
  }

  for (const name of ERROR_NAMES) {
    if (message.includes(name)) return BY_NAME[name];
  }

  // Fall back to the SDK's own code table if it knows the name.
  for (const [code, info] of Object.entries(Errors)) {
    if (message.includes(info.message)) {
      const advice = BY_CODE[Number(code)];
      if (advice) return advice;
    }
  }

  return message || "Something went wrong talking to the escrow contract.";
}
