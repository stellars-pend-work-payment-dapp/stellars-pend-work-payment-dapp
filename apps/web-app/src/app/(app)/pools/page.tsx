import type { Metadata } from "next";
import UnifiedPoolsPage from "@/features/pools/components/pages/UnifiedPoolsPage";

export const metadata: Metadata = {
  title: "Pools | Stellar Payment Gateway",
  description:
    "Supply liquidity, borrow assets, and manage your positions in Stellar Payment Gateway pools.",
};

export default function PoolsPage() {
  return <UnifiedPoolsPage />;
}
