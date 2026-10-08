"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";

import { useWallet } from "@/hooks/useWallet";

import { ESCROW_TOKEN, MAX_MILESTONES, MAX_TITLE_LEN } from "../constants";
import { useEscrowActions } from "../hooks/useEscrowActions";
import {
  fromSmallestUnit,
  toSmallestUnit,
  withThousands,
} from "../utils/format";
import { TxFeedback } from "./TxFeedback";
import { Button, Card, Field, Notice, inputClass } from "./ui";

const decimals = ESCROW_TOKEN.decimals;

interface DraftMilestone {
  title: string;
  amount: string;
}

const emptyDraft = (): DraftMilestone => ({ title: "", amount: "" });

/** Default deadline: two weeks out, expressed as a local `datetime-local` value. */
function defaultDeadline(): string {
  const date = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Creates a job on the escrow contract.
 *
 * Creating a job is free — it only records the agreement on chain. Funding is a
 * separate step on the job page, so a client can review the terms before
 * committing funds.
 */
export default function CreateJobForm() {
  const router = useRouter();
  const { address } = useWallet();
  const actions = useEscrowActions();

  const [milestones, setMilestones] = useState<DraftMilestone[]>([
    emptyDraft(),
  ]);
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [worker, setWorker] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const totals = (() => {
    let total = 0n;
    let invalid = false;
    for (const m of milestones) {
      const parsed = toSmallestUnit(m.amount, decimals);
      if (parsed === null) {
        invalid = true;
        break;
      }
      total += parsed;
    }
    return { total, invalid };
  })();

  const update = (index: number, patch: Partial<DraftMilestone>) => {
    setMilestones((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...patch } : m))
    );
    setFormError(null);
  };

  const validate = (): {
    ok: boolean;
    problem?: string;
    amounts?: bigint[];
    deadlineSeconds?: number;
  } => {
    if (!address)
      return { ok: false, problem: "Connect a Stellar wallet first." };
    if (milestones.length === 0)
      return { ok: false, problem: "Add at least one milestone." };
    if (milestones.length > MAX_MILESTONES)
      return { ok: false, problem: `At most ${MAX_MILESTONES} milestones.` };

    const amounts: bigint[] = [];
    for (const [index, milestone] of milestones.entries()) {
      const title = milestone.title.trim();
      if (title.length === 0)
        return { ok: false, problem: `Milestone ${index + 1} needs a title.` };
      if (title.length > MAX_TITLE_LEN)
        return {
          ok: false,
          problem: `Milestone ${index + 1} title is longer than ${MAX_TITLE_LEN} characters.`,
        };
      const amount = toSmallestUnit(milestone.amount, decimals);
      if (amount === null)
        return {
          ok: false,
          problem: `Milestone ${index + 1} needs an amount greater than zero.`,
        };
      amounts.push(amount);
    }

    const parsedDeadline = Math.floor(new Date(deadline).getTime() / 1000);
    if (!Number.isFinite(parsedDeadline) || parsedDeadline <= 0)
      return { ok: false, problem: "Choose a deadline." };
    if (parsedDeadline <= Math.floor(Date.now() / 1000) + 60)
      return { ok: false, problem: "The deadline must be in the future." };

    const reserved = worker.trim();
    if (reserved) {
      if (!StrKey.isValidEd25519PublicKey(reserved))
        return {
          ok: false,
          problem: "The worker address does not look valid.",
        };
      if (reserved === address)
        return {
          ok: false,
          problem: "The worker must be a different account.",
        };
    }

    return { ok: true, amounts, deadlineSeconds: parsedDeadline };
  };

  const submit = async () => {
    const check = validate();
    if (!check.ok || !check.amounts || !check.deadlineSeconds) {
      setFormError(check.problem ?? "Please fix the form.");
      return;
    }

    // The contract returns the id of the job it created; using that directly
    // avoids landing on the wrong job when somebody else creates one at the
    // same time.
    const newJobId = await actions.createJob({
      milestones: check.amounts.map((amount, index) => ({
        title: milestones[index].title.trim(),
        amount,
      })),
      worker: worker.trim() || undefined,
      deadline: check.deadlineSeconds,
    });

    if (newJobId === null) return;
    router.push(`/jobs/${newJobId}`);
  };

  return (
    <section className="flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <Link href="/jobs" className="text-sm font-semibold underline">
        ← All jobs
      </Link>

      <Card className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Create a job</h1>
          <p className="mt-1 text-sm">
            Describe the work and split the budget into milestones. Creating the
            job is free and moves no funds — you fund the escrow on the job page
            once you are happy with the terms.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Milestones</h2>
            <span className="text-xs opacity-70">
              {totals.invalid
                ? "—"
                : `${withThousands(fromSmallestUnit(totals.total, decimals))} ${ESCROW_TOKEN.code}`}
            </span>
          </div>

          {milestones.map((milestone, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 rounded-2xl border border-black/10 bg-white/60 p-3 sm:flex-row sm:items-end"
            >
              <div className="flex-1">
                <Field label={`Milestone ${index + 1}`}>
                  <input
                    className={inputClass}
                    value={milestone.title}
                    maxLength={MAX_TITLE_LEN}
                    onChange={(e) => update(index, { title: e.target.value })}
                    placeholder="Design mockups"
                  />
                </Field>
              </div>
              <div className="sm:w-40">
                <Field label={`Amount (${ESCROW_TOKEN.code})`}>
                  <input
                    className={inputClass}
                    value={milestone.amount}
                    inputMode="decimal"
                    onChange={(e) => update(index, { amount: e.target.value })}
                    placeholder="25.0"
                  />
                </Field>
              </div>
              <Button
                variant="secondary"
                className="sm:mb-1"
                disabled={milestones.length === 1 || actions.isBusy}
                onClick={() =>
                  setMilestones((prev) => prev.filter((_, i) => i !== index))
                }
              >
                Remove
              </Button>
            </div>
          ))}

          <div>
            <Button
              variant="secondary"
              disabled={milestones.length >= MAX_MILESTONES || actions.isBusy}
              onClick={() => setMilestones((prev) => [...prev, emptyDraft()])}
            >
              Add milestone
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Deadline"
            hint="After this, no new work can be submitted and anyone may wind up the escrow."
          >
            <input
              type="datetime-local"
              className={inputClass}
              value={deadline}
              onChange={(e) => {
                setDeadline(e.target.value);
                setFormError(null);
              }}
            />
          </Field>
          <Field
            label="Reserve for a worker (optional)"
            hint="Leave blank to let any worker accept it."
          >
            <input
              className={inputClass}
              value={worker}
              onChange={(e) => {
                setWorker(e.target.value);
                setFormError(null);
              }}
              placeholder="G…"
            />
          </Field>
        </div>

        {formError ? <Notice tone="error">{formError}</Notice> : null}

        <TxFeedback
          pending={actions.pending}
          error={actions.error}
          receipt={actions.receipt}
          onDismiss={actions.clearFeedback}
        />

        <div className="flex items-center gap-3">
          <Button disabled={actions.isBusy || !address} onClick={submit}>
            Create job on chain
          </Button>
          {!address ? (
            <span className="text-xs font-semibold">
              Connect a wallet to create a job.
            </span>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
