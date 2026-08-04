import type { Metadata } from "next";
import Vault from "@/features/vault/components/pages/Vault";

export const metadata: Metadata = {
  title: "Vault | Stellar Payment Gateway",
  description:
    "Discover and deposit into Stellar vaults. Real-time RWA price data and yield-generating strategies on Stellar.",
};

export default function VaultPage() {
  return <Vault />;
}
