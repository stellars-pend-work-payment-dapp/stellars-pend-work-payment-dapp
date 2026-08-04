import { NextRequest, NextResponse } from "next/server";
import type { VenueCandidate } from "@/features/automation/types/automation";
import { calcNetApyBps } from "@/features/automation/utils/netApy";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Mock candidate data — replace with real contract calls to @spg/* clients
function buildMockCandidates(): VenueCandidate[] {
  const raw: Omit<VenueCandidate, "netApyBps">[] = [
    {
      id: "stellar-vault",
      kind: "vault",
      name: "Stellar Vault",
      asset: "USDC",
      grossApyBps: 850,
      borrowCostBps: 0,
      protocolFeeBps: 30,
      amortizedGasBps: 5,
      availableLiquidityUsd: 500_000,
      currentAllocationPct: 40,
    },
    {
      id: "stellar-lending",
      kind: "lending",
      name: "Stellar Lending",
      asset: "USDC",
      grossApyBps: 600,
      borrowCostBps: 0,
      protocolFeeBps: 20,
      amortizedGasBps: 5,
      availableLiquidityUsd: 300_000,
      currentAllocationPct: 30,
    },
    {
      id: "stellar-xlm-pool",
      kind: "pool",
      name: "XLM/USDC Pool",
      asset: "XLM",
      grossApyBps: 1200,
      borrowCostBps: 0,
      protocolFeeBps: 60,
      amortizedGasBps: 10,
      availableLiquidityUsd: 200_000,
      currentAllocationPct: 20,
    },
    {
      id: "stellar-btc-pool",
      kind: "pool",
      name: "BTC/USDC Pool",
      asset: "BTC",
      grossApyBps: 400,
      borrowCostBps: 0,
      protocolFeeBps: 40,
      amortizedGasBps: 10,
      availableLiquidityUsd: 100_000,
      currentAllocationPct: 10,
    },
  ];

  return raw.map((r) => ({ ...r, netApyBps: calcNetApyBps(r) }));
}

export async function GET(_req: NextRequest) {
  try {
    const candidates = buildMockCandidates();
    return NextResponse.json(candidates);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
