import type { Metadata } from "next";
import Strategies from "@/features/strategies/components/Strategies";

export const metadata: Metadata = {
  title: "Strategies | Stellar Payment Gateway",
  description:
    "Compose, simulate, and execute reusable multi-step DeFi strategies across SoroSwap, RWA Lending, Blend, DeFindex, and Liquidity Pools on Stellar.",
};

export default function StrategiesPage() {
  return <Strategies />;
}
