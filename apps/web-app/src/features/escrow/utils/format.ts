import type { i128, u64 } from "@stellar/stellar-sdk/contract";
import type { JobStatus, MilestoneStatus } from "@spg/escrow";

/**
 * Formatting helpers for on-chain values.
 *
 * Amounts arrive from the contract as `bigint` (Soroban `i128`) in the token's
 * smallest unit. Every conversion goes through these helpers so a single
 * rounding rule is applied everywhere.
 */

/** Convert a smallest-unit amount to a decimal string. */
export function fromSmallestUnit(
  amount: i128 | string | number,
  decimals: number
): string {
  const raw = BigInt(amount.toString());
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  const fractionStr = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const body = fractionStr ? `${whole}.${fractionStr}` : whole.toString();
  return negative ? `-${body}` : body;
}

/**
 * Convert a user-entered decimal string to smallest units.
 *
 * Returns `null` for anything that is not a positive number with at most
 * `decimals` decimal places, so callers can reject bad input before it reaches
 * the contract.
 */
export function toSmallestUnit(
  amount: string,
  decimals: number
): bigint | null {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) return null;

  const padded = fraction.padEnd(decimals, "0");
  const value = BigInt(`${whole}${padded}`);
  return value > 0n ? value : null;
}

/** `1234.5` -> `"1,234.5"` */
export function withThousands(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

const JOB_STATUS_LABELS: Record<JobStatus["tag"], string> = {
  Open: "Awaiting funding",
  Funded: "Funded · open for a worker",
  InProgress: "In progress",
  Disputed: "Disputed",
  Completed: "Completed",
  Cancelled: "Cancelled",
  Expired: "Expired",
};

export function jobStatusLabel(status: JobStatus): string {
  return JOB_STATUS_LABELS[status.tag] ?? status.tag;
}

const MILESTONE_STATUS_LABELS: Record<MilestoneStatus["tag"], string> = {
  Pending: "Not submitted",
  Submitted: "Awaiting review",
  Approved: "Paid",
};

export function milestoneStatusLabel(status: MilestoneStatus): string {
  return MILESTONE_STATUS_LABELS[status.tag] ?? status.tag;
}

/** True once a job can no longer change state. */
export function isTerminal(status: JobStatus): boolean {
  return (
    status.tag === "Completed" ||
    status.tag === "Cancelled" ||
    status.tag === "Expired"
  );
}

/** `1791543794` -> `"9 Aug 2026, 14:36"` (local time). */
export function formatTimestamp(ts: u64 | number): string {
  const seconds = Number(ts);
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return new Date(seconds * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Human relative time, e.g. `"in 3 days"` / `"2 hours ago"`. */
export function relativeToNow(ts: u64 | number): string {
  const seconds = Number(ts);
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const deltaSeconds = seconds - Math.floor(Date.now() / 1000);
  const abs = Math.abs(deltaSeconds);
  const units: Array<[number, string]> = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
  ];

  let value = abs;
  let unit = "second";
  for (const [step, name] of units) {
    if (value < step) {
      unit = name;
      break;
    }
    value /= step;
    unit = name;
  }

  const rounded = Math.max(1, Math.round(value));
  const label = `${rounded} ${unit}${rounded === 1 ? "" : "s"}`;
  return deltaSeconds >= 0 ? `in ${label}` : `${label} ago`;
}

/** Shorten an address: `GBB376…JR5K`. */
export function shortenAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** Zeroed proof hash means "no proof submitted yet". */
export function hasProofHash(proofHash: Uint8Array | Buffer): boolean {
  return proofHash.some((byte) => byte !== 0);
}

/** Render a proof hash as lowercase hex. */
export function toHex(bytes: Uint8Array | Buffer): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
