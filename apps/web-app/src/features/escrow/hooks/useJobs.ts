"use client";

import { useQuery } from "@tanstack/react-query";
import type * as Escrow from "@spg/escrow";

import { ESCROW_CONTRACT_ID, JOBS_PAGE_SIZE } from "../constants";
import { unwrapContractResult, useEscrowReadClient } from "./useEscrowClient";

export type Job = Escrow.Job;

const jobsKey = (limit: number) =>
  ["escrow", "jobs", ESCROW_CONTRACT_ID, limit] as const;
const jobKey = (jobId: number) =>
  ["escrow", "job", ESCROW_CONTRACT_ID, jobId] as const;
const settlementKey = (jobId: number) =>
  ["escrow", "settlement", ESCROW_CONTRACT_ID, jobId] as const;

/**
 * The most recent `limit` jobs, newest first.
 *
 * The contract exposes ids in ascending order with a server-side page cap, so
 * the newest page is requested by seeking to `count - limit` rather than by
 * paging from the start.
 */
export function useJobs(limit: number = JOBS_PAGE_SIZE) {
  const client = useEscrowReadClient();

  return useQuery({
    queryKey: jobsKey(limit),
    queryFn: async (): Promise<Job[]> => {
      const { result: count } = await client.get_job_count();
      const total = Number(count);
      if (total === 0) return [];

      const start = Math.max(0, total - limit);
      const page = await client.get_jobs({ start, limit });
      const jobs = unwrapContractResult(page.result);
      return [...jobs].reverse(); // newest first
    },
    staleTime: 5_000,
  });
}

/** A single job, polled so on-chain changes from the other party show up. */
export function useJob(jobId: number, options?: { enabled?: boolean }) {
  const client = useEscrowReadClient();
  const enabled =
    (options?.enabled ?? true) && Number.isInteger(jobId) && jobId > 0;

  return useQuery({
    queryKey: jobKey(jobId),
    queryFn: async (): Promise<Job> => {
      const tx = await client.get_job({ job_id: BigInt(jobId) });
      return unwrapContractResult(tx.result);
    },
    enabled,
    refetchInterval: 15_000,
  });
}

/** The outstanding settlement proposal for a disputed job, if any. */
export function useSettlement(jobId: number, options?: { enabled?: boolean }) {
  const client = useEscrowReadClient();
  const enabled =
    (options?.enabled ?? true) && Number.isInteger(jobId) && jobId > 0;

  return useQuery({
    queryKey: settlementKey(jobId),
    queryFn: async (): Promise<Escrow.Settlement | undefined> => {
      const tx = await client.get_settlement({ job_id: BigInt(jobId) });
      return tx.result;
    },
    enabled,
    refetchInterval: 15_000,
  });
}

/** Job ids created by / worked on by an address, used for the dashboards. */
export function useMyJobIds(address?: string) {
  const client = useEscrowReadClient();

  return useQuery({
    queryKey: ["escrow", "my-jobs", ESCROW_CONTRACT_ID, address],
    enabled: Boolean(address),
    queryFn: async (): Promise<{ asClient: number[]; asWorker: number[] }> => {
      if (!address) return { asClient: [], asWorker: [] };

      const [clientTx, workerTx] = await Promise.all([
        client.get_jobs_for_client({
          client: address,
          start: 0,
          limit: JOBS_PAGE_SIZE,
        }),
        client.get_jobs_for_worker({
          worker: address,
          start: 0,
          limit: JOBS_PAGE_SIZE,
        }),
      ]);

      return {
        asClient: unwrapContractResult(clientTx.result).map(Number),
        asWorker: unwrapContractResult(workerTx.result).map(Number),
      };
    },
    staleTime: 5_000,
  });
}
