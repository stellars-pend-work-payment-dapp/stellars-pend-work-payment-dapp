"use client";

import { useMemo } from "react";
import * as Escrow from "@spg/escrow";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";

import {
  allowHttpForSoroban,
  networkPassphrase,
  rpcUrl,
} from "@/lib/constants/network";

import { ESCROW_CONTRACT_ID } from "../constants";

/**
 * Builds a Soroban client for the deployed escrow contract.
 *
 * `publicKey` is the invoking account. Read calls work without it; every state
 * changing call needs it, because the contract's `require_auth` checks are
 * resolved against the invoker during simulation.
 */
export function createEscrowClient(publicKey?: string): Escrow.Client {
  return new Escrow.Client({
    contractId: ESCROW_CONTRACT_ID,
    networkPassphrase,
    rpcUrl,
    publicKey,
    ...(allowHttpForSoroban && { allowHttp: true }),
  });
}

/** Shared read-only client. */
export function useEscrowReadClient(): Escrow.Client {
  return useMemo(() => createEscrowClient(), []);
}

/**
 * Unwrap the contract's Rust `Result` into a value or a thrown error.
 *
 * The bindings model `Result<T, Error>` faithfully instead of flattening it, so
 * every read has to be unwrapped explicitly — which is what surfaces contract
 * errors as real failures rather than `undefined` data.
 */
export function unwrapContractResult<T>(result: {
  isErr(): boolean;
  unwrap(): T;
  unwrapErr(): { message: string };
}): T {
  if (result.isErr()) {
    throw new Error(result.unwrapErr().message);
  }
  return result.unwrap();
}

/** Narrow an `AssembledTransaction<T>` to its decoded `T`, or throw. */
export function transactionResult<T>(tx: AssembledTransaction<T>): T {
  return tx.result;
}
