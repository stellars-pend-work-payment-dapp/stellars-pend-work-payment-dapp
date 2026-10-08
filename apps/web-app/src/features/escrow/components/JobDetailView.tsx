"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Job, Milestone } from "@spg/escrow";

import { useWallet } from "@/hooks/useWallet";

import { ESCROW_TOKEN, MAX_REASON_LEN } from "../constants";
import { useEscrowActions } from "../hooks/useEscrowActions";
import { useJob, useSettlement } from "../hooks/useJobs";
import { useNowSeconds } from "../hooks/useNow";
import {
  formatTimestamp,
  fromSmallestUnit,
  isTerminal,
  milestoneStatusLabel,
  relativeToNow,
  shortenAddress,
  toHex,
  toSmallestUnit,
  withThousands,
} from "../utils/format";
import { isUsableProofReference, sha256Bytes } from "../utils/proof";
import { TxFeedback } from "./TxFeedback";
import {
  Button,
  Card,
  Field,
  JobStatusPill,
  MilestoneStatusPill,
  Notice,
  Spinner,
  inputClass,
} from "./ui";

const decimals = ESCROW_TOKEN.decimals;

function xlm(value: bigint) {
  return withThousands(fromSmallestUnit(value, decimals));
}

/** Trim a trailing `.0` so "10.0 XLM" reads as "10 XLM". */
function xlmPlain(value: bigint) {
  return xlm(value).replace(/,/g, "");
}

/** One milestone, with the action the current role is allowed to take. */
function MilestoneRow({
  milestone,
  index,
  canSubmit,
  canApprove,
  deadlinePassed,
  busy,
  onSubmit,
  onApprove,
}: {
  milestone: Milestone;
  index: number;
  canSubmit: boolean;
  canApprove: boolean;
  deadlinePassed: boolean;
  busy: boolean;
  onSubmit: (index: number, reference: string) => void;
  onApprove: (index: number) => void;
}) {
  const [reference, setReference] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const submitted = milestone.status.tag === "Submitted";
  const approved = milestone.status.tag === "Approved";

  return (
    <div className="rounded-2xl border border-black/10 bg-white/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-xs opacity-60">#{index + 1}</span>
          <span className="font-semibold">{milestone.title}</span>
          <MilestoneStatusPill status={milestone.status.tag} />
        </span>
        <span className="text-sm font-semibold">
          {xlm(milestone.amount)} {ESCROW_TOKEN.code}
        </span>
      </div>

      <p className="mt-1 text-xs opacity-70">
        {milestoneStatusLabel(milestone.status)}
        {milestone.submitted_at > 0
          ? ` · submitted ${formatTimestamp(milestone.submitted_at)}`
          : ""}
      </p>

      {canSubmit && !deadlinePassed ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field
            label="Proof of delivery"
            hint="A commit URL, document link or IPFS CID. Only its SHA-256 hash is stored on chain."
          >
            <input
              className={inputClass}
              value={reference}
              onChange={(e) => {
                setReference(e.target.value);
                setLocalError(null);
              }}
              placeholder="https://github.com/…/commit/abc123"
            />
          </Field>
          <Button
            disabled={busy}
            onClick={() => {
              if (!isUsableProofReference(reference)) {
                setLocalError("Enter a reference of at least 8 characters.");
                return;
              }
              onSubmit(index, reference);
            }}
            className="shrink-0"
          >
            {submitted ? "Replace proof" : "Submit work"}
          </Button>
        </div>
      ) : null}

      {canSubmit && deadlinePassed ? (
        <Notice tone="info">
          The deadline has passed, so no further work can be submitted on this
          milestone.
        </Notice>
      ) : null}

      {localError ? (
        <p className="mt-2 text-xs font-semibold text-[#8F1D18]">
          {localError}
        </p>
      ) : null}

      {canApprove ? (
        <div className="mt-3 flex items-center gap-3">
          <Button disabled={busy} onClick={() => onApprove(index)}>
            Approve &amp; release {xlm(milestone.amount)} {ESCROW_TOKEN.code}
          </Button>
          <span className="text-xs opacity-70">
            Sends the escrowed amount to{" "}
            {milestone.status.tag === "Submitted" ? "the worker" : "the worker"}
            .
          </span>
        </div>
      ) : null}

      {approved && milestone.proof_hash ? (
        <p className="mt-2 break-all text-xs opacity-60">
          proof: {toHex(milestone.proof_hash)}
        </p>
      ) : null}
    </div>
  );
}

/** Settlement negotiation UI, shown while a job is disputed. */
function SettlementPanel({
  job,
  isClient,
  isWorker,
  busy,
  proposedBy,
  workerAmount,
  clientAmount,
  onPropose,
  onAccept,
}: {
  job: Job;
  isClient: boolean;
  isWorker: boolean;
  busy: boolean;
  proposedBy?: string;
  workerAmount?: bigint;
  clientAmount?: bigint;
  onPropose: (clientAmount: bigint) => void;
  onAccept: () => void;
}) {
  const remaining = job.total - job.released;
  const [share, setShare] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const proposed = Boolean(proposedBy);
  // The contract only lets the client or the worker propose, so if the proposal
  // came from the client it is the worker who must accept it, and vice versa.
  const youProposed =
    proposed &&
    ((isClient && proposedBy === job.client) ||
      (isWorker && proposedBy !== job.client));

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Settlement</h2>
      <p className="text-sm">
        A dispute is resolved only when both parties agree on how to split the{" "}
        <strong>
          {xlm(remaining)} {ESCROW_TOKEN.code}
        </strong>{" "}
        still in escrow. There is no arbitrator key — neither side can
        unilaterally take the funds.
      </p>

      {proposed ? (
        <div className="rounded-2xl border border-black/10 bg-white/60 p-4 text-sm">
          <p className="font-semibold">
            {youProposed ? "Your proposal" : "Proposal on the table"}
          </p>
          <p className="mt-1">
            Client receives{" "}
            <strong>
              {xlm(clientAmount ?? 0n)} {ESCROW_TOKEN.code}
            </strong>
            , worker receives{" "}
            <strong>
              {xlm(workerAmount ?? 0n)} {ESCROW_TOKEN.code}
            </strong>
            .
          </p>
          {youProposed ? (
            <p className="mt-2 text-xs opacity-70">
              Waiting for the counterparty to accept. You cannot accept your own
              proposal.
            </p>
          ) : (
            <Button className="mt-3" disabled={busy} onClick={onAccept}>
              Accept this settlement
            </Button>
          )}
        </div>
      ) : (
        <>
          <Field
            label="Amount returned to the client"
            hint={`The worker receives the rest. Must be between 0 and ${xlm(remaining)}.`}
          >
            <input
              className={inputClass}
              value={share}
              inputMode="decimal"
              onChange={(e) => {
                setShare(e.target.value);
                setLocalError(null);
              }}
              placeholder="0.0"
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button
              disabled={busy}
              onClick={() => {
                const parsed = toSmallestUnit(share, decimals);
                if (parsed === null) {
                  setLocalError("Enter a positive amount.");
                  return;
                }
                if (parsed > remaining) {
                  setLocalError(
                    `That is more than the ${xlm(remaining)} still in escrow.`
                  );
                  return;
                }
                onPropose(parsed);
              }}
            >
              Propose settlement
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setShare("0");
                setLocalError(null);
              }}
            >
              Full refund to client
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setShare(xlmPlain(remaining));
                setLocalError(null);
              }}
            >
              Full payment to worker
            </Button>
          </div>
        </>
      )}

      {localError ? (
        <p className="text-xs font-semibold text-[#8F1D18]">{localError}</p>
      ) : null}

      {isWorker && !proposed ? (
        <p className="text-xs opacity-70">
          As the worker you can propose a split too — the client would then have
          to accept it.
        </p>
      ) : null}
    </Card>
  );
}

export default function JobDetailView({ jobId }: { jobId: number }) {
  const { address } = useWallet();
  const jobQuery = useJob(jobId);
  const settlementQuery = useSettlement(jobId, {
    enabled: jobQuery.data?.status.tag === "Disputed",
  });
  const actions = useEscrowActions();
  const [disputeReason, setDisputeReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const job = jobQuery.data;
  const settlement = settlementQuery.data;
  const now = useNowSeconds();

  const derived = useMemo(() => {
    if (!job) return null;
    const isClient = Boolean(address && job.client === address);
    const isWorker = Boolean(address && job.worker === address);
    const deadlinePassed = Number(job.deadline) <= now;
    const consideredFor = !job.worker || job.worker === address;
    const released = job.milestones.filter(
      (m) => m.status.tag === "Approved"
    ).length;
    return {
      isClient,
      isWorker,
      isParticipant: isClient || isWorker,
      deadlinePassed,
      consideredFor,
      released,
      remaining: job.total - job.released,
      status: job.status.tag,
    };
  }, [job, address, now]);

  if (jobQuery.isLoading) {
    return (
      <div className="flex w-full max-w-3xl items-center gap-3 px-4 py-8">
        <Spinner />
        <span>Reading job #{jobId} from the escrow contract…</span>
      </div>
    );
  }

  if (jobQuery.isError || !job || !derived) {
    return (
      <div className="w-full max-w-3xl px-4 py-8">
        <Notice tone="error">
          <div className="flex flex-col gap-3">
            <span>
              Job #{jobId} could not be read from the escrow contract. It may
              not exist on this deployment.
            </span>
            <Link href="/jobs" className="font-semibold underline">
              Back to all jobs
            </Link>
          </div>
        </Notice>
      </div>
    );
  }

  const busy = actions.isBusy;
  const terminal = isTerminal(job.status);

  return (
    <section className="flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Link href="/jobs" className="text-sm font-semibold underline">
        ← All jobs
      </Link>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Job #{job.id.toString()}</h1>
              <JobStatusPill status={job.status.tag} />
            </span>
            <span className="text-sm opacity-70">
              Created {formatTimestamp(job.created_at)}
            </span>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">
              {xlm(job.total)} {ESCROW_TOKEN.code}
            </div>
            <div className="text-xs opacity-70">total budget</div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs opacity-60">Client</dt>
            <dd className="font-semibold">
              {shortenAddress(job.client)}
              {derived.isClient ? " (you)" : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs opacity-60">Worker</dt>
            <dd className="font-semibold">
              {job.worker
                ? `${shortenAddress(job.worker)}${derived.isWorker ? " (you)" : ""}`
                : `open to anyone${derived.consideredFor ? " (you can accept)" : ""}`}
            </dd>
          </div>
          <div>
            <dt className="text-xs opacity-60">Deadline</dt>
            <dd className="font-semibold">
              {formatTimestamp(job.deadline)}
              <span className="block text-xs font-normal opacity-70">
                {relativeToNow(job.deadline)}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs opacity-60">In escrow now</dt>
            <dd className="font-semibold">
              {xlm(derived.remaining)} {ESCROW_TOKEN.code}
            </dd>
          </div>
        </dl>

        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
            <div
              className="h-full rounded-full bg-[#1B7F4D]"
              style={{
                width: `${(derived.released / job.milestones.length) * 100}%`,
              }}
            />
          </div>
          <p className="mt-1 text-xs opacity-70">
            {derived.released} of {job.milestones.length} milestones paid ·{" "}
            {xlm(job.released)} {ESCROW_TOKEN.code} released
          </p>
        </div>
      </Card>

      <TxFeedback
        pending={actions.pending}
        error={actions.error}
        receipt={actions.receipt}
        onDismiss={actions.clearFeedback}
      />

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">What you can do</h2>

        {!actions.hasWallet ? (
          <Notice tone="info">
            Connect a Stellar wallet (for example Freighter) to act on this job.
          </Notice>
        ) : null}

        {derived.status === "Open" && derived.isClient ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              The job is created but nothing is escrowed yet. Funding moves{" "}
              {xlm(job.total)} {ESCROW_TOKEN.code} from your wallet into the
              contract.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => actions.fundJob(job.id)}>
                Fund escrow with {xlm(job.total)} {ESCROW_TOKEN.code}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => actions.cancelJob(job.id)}
              >
                Cancel job
              </Button>
            </div>
          </div>
        ) : null}

        {derived.status === "Open" && !derived.isClient ? (
          <p className="text-sm">
            Waiting for the client to fund the escrow. Nothing can be accepted
            until the money is in the contract.
          </p>
        ) : null}

        {derived.status === "Funded" && derived.isClient ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              {xlm(job.total)} {ESCROW_TOKEN.code} is escrowed and waiting for a
              worker. No worker has accepted yet, so you can still cancel for a
              full refund.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => actions.cancelJob(job.id)}
              >
                Cancel &amp; refund {xlm(job.total)} {ESCROW_TOKEN.code}
              </Button>
            </div>
          </div>
        ) : null}

        {derived.status === "Funded" && !derived.isClient ? (
          derived.consideredFor ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                {job.worker
                  ? "This job is reserved for you. Accept it to start work."
                  : "This job is open. Accepting assigns it to your wallet — first come, first served."}
              </p>
              <Button disabled={busy} onClick={() => actions.acceptJob(job.id)}>
                Accept job
              </Button>
            </div>
          ) : (
            <p className="text-sm">
              This job is reserved for a different worker (
              {job.worker ? shortenAddress(job.worker) : "someone else"}).
            </p>
          )
        ) : null}

        {derived.status === "InProgress" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {derived.isClient
                ? "Review each submitted milestone. Approving releases that milestone's escrow to the worker immediately."
                : derived.isWorker
                  ? "Submit each milestone as you finish it. Payment is released when the client approves."
                  : "You are not a party to this job, so you can only read it."}
            </p>

            {derived.isParticipant ? (
              <div className="flex flex-col gap-2">
                <Field
                  label="Something wrong? Open a dispute"
                  hint={`Freezes automated payouts and starts a settlement negotiation. Max ${MAX_REASON_LEN} characters.`}
                >
                  <input
                    className={inputClass}
                    value={disputeReason}
                    onChange={(e) => {
                      setDisputeReason(e.target.value);
                      setReasonError(null);
                    }}
                    placeholder="Work delivered does not match the brief"
                  />
                </Field>
                <div>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (disputeReason.trim().length < 3) {
                        setReasonError("Give a short reason for the dispute.");
                        return;
                      }
                      actions.openDispute(job.id, disputeReason.trim());
                    }}
                  >
                    Open dispute
                  </Button>
                </div>
                {reasonError ? (
                  <p className="text-xs font-semibold text-[#8F1D18]">
                    {reasonError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {derived.status === "Disputed" ? (
          <div className="flex flex-col gap-3">
            <Notice tone="info">
              This job is disputed. Milestone approvals and deadline wind-ups
              are paused until the dispute is closed or a settlement is agreed.
            </Notice>
            {derived.isParticipant ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => actions.closeDispute(job.id)}
              >
                Close dispute and resume normal operation
              </Button>
            ) : null}
          </div>
        ) : null}

        {(derived.status === "Funded" || derived.status === "InProgress") &&
        derived.deadlinePassed ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              The deadline has passed. Anyone can wind the escrow up: milestones
              never delivered are refunded to the client, and milestones
              delivered before the deadline are paid to the worker.
            </p>
            <div>
              <Button disabled={busy} onClick={() => actions.expireJob(job.id)}>
                Wind up escrow
              </Button>
            </div>
          </div>
        ) : null}

        {terminal ? (
          <p className="text-sm">
            This job is finished — nothing further can change.
          </p>
        ) : null}
      </Card>

      {derived.status === "Disputed" && derived.isParticipant ? (
        <SettlementPanel
          job={job}
          isClient={derived.isClient}
          isWorker={derived.isWorker}
          busy={busy}
          proposedBy={settlement?.proposed_by}
          clientAmount={settlement?.client_amount}
          workerAmount={settlement?.worker_amount}
          onPropose={(amount) => actions.proposeSettlement(job.id, amount)}
          onAccept={() => actions.acceptSettlement(job.id)}
        />
      ) : null}

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">
          Milestones ({job.milestones.length})
        </h2>
        {job.milestones.map((milestone, index) => {
          const canApprove =
            derived.isClient &&
            derived.status === "InProgress" &&
            milestone.status.tag === "Submitted";
          const canSubmit = derived.isWorker && derived.status === "InProgress";

          return (
            <MilestoneRow
              key={index}
              milestone={milestone}
              index={index}
              canSubmit={canSubmit}
              canApprove={canApprove}
              deadlinePassed={derived.deadlinePassed}
              busy={busy}
              onSubmit={async (idx, reference) => {
                const hash = await sha256Bytes(reference.trim());
                await actions.submitMilestone(job.id, idx, hash);
              }}
              onApprove={(idx) => actions.approveMilestone(job.id, idx)}
            />
          );
        })}
      </Card>
    </section>
  );
}
