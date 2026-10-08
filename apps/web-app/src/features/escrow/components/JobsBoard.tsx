"use client";

import Link from "next/link";
import { useState } from "react";

import { useWallet } from "@/hooks/useWallet";

import {
  ESCROW_CONTRACT_ID,
  ESCROW_TOKEN,
  explorerContractUrl,
} from "../constants";
import { useJobs, useMyJobIds, type Job } from "../hooks/useJobs";
import {
  fromSmallestUnit,
  jobStatusLabel,
  relativeToNow,
  shortenAddress,
  withThousands,
} from "../utils/format";
import { Button, Card, CARD, JobStatusPill, Notice, Spinner } from "./ui";

type Filter = "all" | "client" | "worker";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All jobs" },
  { id: "client", label: "I'm the client" },
  { id: "worker", label: "I'm the worker" },
];

function JobCard({ job, viewer }: { job: Job; viewer?: string }) {
  const approved = job.milestones.filter(
    (m) => m.status.tag === "Approved"
  ).length;
  const remaining = job.total - job.released;
  const role =
    viewer && job.client === viewer
      ? "client"
      : viewer && job.worker === viewer
        ? "worker"
        : null;

  return (
    <Link href={`/jobs/${job.id}`} className="block">
      <div
        className={`${CARD} flex flex-col gap-3 transition-transform hover:-translate-y-0.5`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="text-sm font-bold">Job #{job.id.toString()}</span>
            <JobStatusPill status={job.status.tag} />
            {role ? (
              <span className="rounded-full bg-black/10 px-2.5 py-0.5 text-[11px] font-semibold capitalize">
                you are the {role}
              </span>
            ) : null}
          </span>
          <span className="text-sm font-semibold">
            {withThousands(fromSmallestUnit(job.total, ESCROW_TOKEN.decimals))}{" "}
            {ESCROW_TOKEN.code}
          </span>
        </div>

        <p className="text-sm">{jobStatusLabel(job.status)}</p>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="opacity-60">Milestones paid</dt>
            <dd className="font-semibold">
              {approved}/{job.milestones.length}
            </dd>
          </div>
          <div>
            <dt className="opacity-60">Still in escrow</dt>
            <dd className="font-semibold">
              {withThousands(
                fromSmallestUnit(remaining, ESCROW_TOKEN.decimals)
              )}{" "}
              {ESCROW_TOKEN.code}
            </dd>
          </div>
          <div>
            <dt className="opacity-60">Worker</dt>
            <dd className="font-semibold">
              {job.worker ? shortenAddress(job.worker) : "open to anyone"}
            </dd>
          </div>
          <div>
            <dt className="opacity-60">Deadline</dt>
            <dd className="font-semibold">{relativeToNow(job.deadline)}</dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}

/**
 * The job marketplace: every job on the contract, with tabs for the jobs the
 * connected wallet participates in.
 */
export default function JobsBoard() {
  const { address } = useWallet();
  const [filter, setFilter] = useState<Filter>("all");

  const jobsQuery = useJobs();
  const myJobsQuery = useMyJobIds(address);

  const allJobs = jobsQuery.data ?? [];
  const mine = myJobsQuery.data ?? { asClient: [], asWorker: [] };

  const visible =
    filter === "all"
      ? allJobs
      : allJobs.filter((job) =>
          filter === "client" ? job.client === address : job.worker === address
        );

  const filterCount = (id: Filter) => {
    if (id === "all") return allJobs.length;
    if (id === "client") return mine.asClient.length;
    return mine.asWorker.length;
  };

  return (
    <section className="flex w-full max-w-4xl flex-col gap-5 px-4 py-6">
      <header className={`${CARD} flex flex-col gap-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Work escrow</h1>
            <p className="mt-1 max-w-xl text-sm">
              Hire a worker and lock the payment in a Soroban escrow. Funds are
              only released from the contract when you approve the delivered
              work.
            </p>
          </div>
          <Link href="/jobs/new">
            <Button>Create a job</Button>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <span>
            <span className="opacity-60">Wallet: </span>
            <span className="font-semibold">
              {address ? shortenAddress(address) : "not connected"}
            </span>
          </span>
          <span>
            <span className="opacity-60">Escrow contract: </span>
            <a
              className="font-semibold underline"
              href={explorerContractUrl()}
              target="_blank"
              rel="noreferrer"
            >
              {shortenAddress(ESCROW_CONTRACT_ID, 8, 6)}
            </a>
          </span>
          <span>
            <span className="opacity-60">Denominated in: </span>
            <span className="font-semibold">{ESCROW_TOKEN.code}</span>
          </span>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`cursor-pointer rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
              filter === f.id
                ? "bg-[#0F0F0F] text-white"
                : "bg-white/20 text-white hover:bg-white/30"
            }`}
          >
            {f.label}
            <span className="ml-2 opacity-70">{filterCount(f.id)}</span>
          </button>
        ))}
      </div>

      {jobsQuery.isLoading ? (
        <Card className="flex items-center gap-3">
          <Spinner className="text-[#0F0F0F]" />
          <span>Reading jobs from the contract…</span>
        </Card>
      ) : null}

      {jobsQuery.isError ? (
        <Notice tone="error">
          Could not read jobs from the escrow contract:{" "}
          {jobsQuery.error instanceof Error
            ? jobsQuery.error.message
            : "unknown error"}
        </Notice>
      ) : null}

      {!jobsQuery.isLoading && !jobsQuery.isError && visible.length === 0 ? (
        <Card className="flex flex-col items-start gap-3">
          <span className="font-semibold">
            {filter === "all"
              ? "No jobs yet."
              : "This wallet is not part of any job yet."}
          </span>
          <span className="text-sm">
            Create the first job and fund it from your wallet — it will appear
            here with a link to the funding transaction.
          </span>
          <Link href="/jobs/new">
            <Button variant="secondary">Create a job</Button>
          </Link>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3">
        {visible.map((job) => (
          <JobCard key={job.id.toString()} job={job} viewer={address} />
        ))}
      </div>

      {filter !== "all" && myJobsQuery.isError ? (
        <Notice tone="info">
          Your personal job index could not be read; showing all jobs instead.
        </Notice>
      ) : null}
    </section>
  );
}
