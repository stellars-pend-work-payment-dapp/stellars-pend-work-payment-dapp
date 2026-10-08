import * as Escrow from "@spg/escrow";

import { getAssetsConfig } from "@/lib/constants/assets.config";
import { clientEnv } from "@/lib/env.client";

/**
 * Deployed `work-escrow` contract for the configured network.
 *
 * `@spg/escrow` is generated from the deployed contract, so the id in its
 * `networks` export is a real, current deployment. `NEXT_PUBLIC_ESCROW_CONTRACT_ID`
 * overrides it so a fresh deployment can be pointed at without regenerating and
 * rebuilding the bindings.
 */
export const ESCROW_CONTRACT_ID =
  clientEnv.escrowContractId || Escrow.networks.testnet.contractId;

/**
 * Asset the escrow is denominated in. Jobs are paid in XLM by default, using
 * the native Stellar Asset Contract, so a reviewer needs no third-party token
 * to exercise the flow end to end.
 */
export const ESCROW_TOKEN = getAssetsConfig().XLM;

/** Mirrors `MAX_MILESTONES` in the contract; the UI refuses to build more. */
export const MAX_MILESTONES = 20;
/** Mirrors `MAX_TITLE_LEN`. */
export const MAX_TITLE_LEN = 64;
/** Mirrors `MAX_REASON_LEN`. */
export const MAX_REASON_LEN = 256;
/** Mirrors `MAX_PAGE_SIZE`; the contract rejects larger pages. */
export const JOBS_PAGE_SIZE = 20;

const NETWORK_SEGMENT =
  clientEnv.stellarNetwork === "PUBLIC" ? "public" : "testnet";

/** Public explorer link for a transaction. */
export function explorerTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/${NETWORK_SEGMENT}/tx/${hash}`;
}

/** Public explorer link for the escrow contract. */
export function explorerContractUrl(): string {
  return `https://stellar.expert/explorer/${NETWORK_SEGMENT}/contract/${ESCROW_CONTRACT_ID}`;
}
