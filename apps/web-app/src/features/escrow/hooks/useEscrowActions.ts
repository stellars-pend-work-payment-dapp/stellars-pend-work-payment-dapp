"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MilestoneInput } from "@spg/escrow";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { Buffer } from "buffer";

import { useWallet } from "@/hooks/useWallet";

import { ESCROW_TOKEN } from "../constants";
import { describeEscrowError } from "../utils/errors";
import { createEscrowClient, unwrapContractResult } from "./useEscrowClient";

/** What the last successful action produced, for the transaction receipt UI. */
export interface TxReceipt {
  action: string;
  hash: string;
}

export interface CreateJobInput {
  milestones: MilestoneInput[];
  /** Optional: reserve the job for one worker instead of leaving it open. */
  worker?: string;
  /** Unix timestamp (seconds) after which the escrow can be wound up. */
  deadline: number;
}

/**
 * Every state-changing escrow call, in one place.
 *
 * Behaviour that every action shares:
 * - the connected address is the invoker, and it must be present;
 * - a second call is refused while one is in flight, so a double click cannot
 *   produce two transactions;
 * - the wallet handles signing, so nothing is signed without the user seeing it;
 * - on success the escrow queries are invalidated, so the UI re-reads on-chain
 *   state rather than assuming what the write did;
 * - failures are translated into an actionable message.
 *
 * Job ids are `bigint` because that is what the contract uses (`u64`). Keeping
 * them wide end to end avoids a lossy `Number()` round trip.
 */
export function useEscrowActions() {
  const { address, signTransaction } = useWallet();
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TxReceipt | null>(null);

  // A ref, not state: it must be up to date synchronously, before React has
  // re-rendered, or a fast double click slips through.
  const inFlight = useRef(false);

  const clearFeedback = useCallback(() => {
    setError(null);
    setReceipt(null);
  }, []);

  const run = useCallback(
    async <T>(
      action: string,
      build: (
        client: ReturnType<typeof createEscrowClient>,
        invoker: string
      ) => Promise<AssembledTransaction<T>>,
      /** Called with the decoded return value once the network confirms it. */
      onConfirmed?: (result: T) => void
    ): Promise<boolean> => {
      if (inFlight.current) return false;
      if (!address) {
        setError("Connect a Stellar wallet first.");
        return false;
      }

      inFlight.current = true;
      setPending(action);
      setError(null);
      setReceipt(null);

      try {
        const client = createEscrowClient(address);
        const tx = await build(client, address);
        const sent = await tx.signAndSend({ signTransaction });

        const hash = sent.sendTransactionResponse?.hash ?? "";

        // A Rust `Err` return still needs checking: depending on how the host
        // surfaces it, the call can "succeed" while carrying a contract error.
        const result = sent.result as unknown;
        if (
          result &&
          typeof result === "object" &&
          typeof (result as { isErr?: unknown }).isErr === "function" &&
          (result as { isErr(): boolean }).isErr()
        ) {
          const wrapped = result as { unwrapErr(): { message: string } };
          throw new Error(wrapped.unwrapErr().message);
        }

        onConfirmed?.(sent.result);
        setReceipt({ action, hash });
        await queryClient.invalidateQueries({ queryKey: ["escrow"] });
        return true;
      } catch (err) {
        setError(describeEscrowError(err));
        return false;
      } finally {
        inFlight.current = false;
        setPending(null);
      }
    },
    [address, signTransaction, queryClient]
  );

  return {
    address,
    hasWallet: Boolean(address),
    pending,
    isBusy: pending !== null,
    error,
    receipt,
    clearFeedback,
    isPending: (action: string) => pending === action,

    /**
     * Returns the id of the job the contract just created, or `null` if the
     * transaction was refused or failed.
     *
     * The id comes from the call's own return value rather than from a
     * follow-up `get_job_count()` read, so a job created concurrently by
     * somebody else cannot send the user to the wrong page.
     */
    createJob: useCallback(
      async (input: CreateJobInput): Promise<bigint | null> => {
        let createdId: bigint | null = null;
        const ok = await run(
          "Create job",
          (client, invoker) =>
            client.create_job({
              client: invoker,
              worker: input.worker || undefined,
              token: ESCROW_TOKEN.contract,
              milestones: input.milestones,
              // The UI works in epoch seconds; the contract takes `u64`.
              deadline: BigInt(input.deadline),
            }),
          (result) => {
            createdId = unwrapContractResult(result);
          }
        );
        return ok ? createdId : null;
      },
      [run]
    ),

    fundJob: useCallback(
      (jobId: bigint) =>
        run("Fund escrow", (client, invoker) =>
          client.fund_job({ job_id: jobId, client: invoker })
        ),
      [run]
    ),

    acceptJob: useCallback(
      (jobId: bigint) =>
        run("Accept job", (client, invoker) =>
          client.accept_job({ job_id: jobId, worker: invoker })
        ),
      [run]
    ),

    submitMilestone: useCallback(
      (jobId: bigint, index: number, proofHash: Uint8Array) =>
        run("Submit work", (client, invoker) =>
          client.submit_milestone({
            job_id: jobId,
            index,
            worker: invoker,
            proof_hash: Buffer.from(proofHash),
          })
        ),
      [run]
    ),

    approveMilestone: useCallback(
      (jobId: bigint, index: number) =>
        run("Release payment", (client) =>
          client.approve_milestone({ job_id: jobId, index })
        ),
      [run]
    ),

    cancelJob: useCallback(
      (jobId: bigint) =>
        run("Cancel job", (client, invoker) =>
          client.cancel_job({ job_id: jobId, client: invoker })
        ),
      [run]
    ),

    openDispute: useCallback(
      (jobId: bigint, reason: string) =>
        run("Open dispute", (client, invoker) =>
          client.open_dispute({ job_id: jobId, caller: invoker, reason })
        ),
      [run]
    ),

    closeDispute: useCallback(
      (jobId: bigint) =>
        run("Close dispute", (client, invoker) =>
          client.close_dispute({ job_id: jobId, caller: invoker })
        ),
      [run]
    ),

    proposeSettlement: useCallback(
      (jobId: bigint, clientAmount: bigint) =>
        run("Propose settlement", (client, invoker) =>
          client.propose_settlement({
            job_id: jobId,
            proposer: invoker,
            client_amount: clientAmount,
          })
        ),
      [run]
    ),

    acceptSettlement: useCallback(
      (jobId: bigint) =>
        run("Accept settlement", (client, invoker) =>
          client.accept_settlement({ job_id: jobId, acceptor: invoker })
        ),
      [run]
    ),

    expireJob: useCallback(
      (jobId: bigint) =>
        run("Wind up escrow", (client) => client.expire_job({ job_id: jobId })),
      [run]
    ),
  };
}

export type EscrowActions = ReturnType<typeof useEscrowActions>;
