import type { Metadata } from "next";
import Oracle from "@/features/stocks/components/pages/Oracle";

export const metadata: Metadata = {
  title: "Stocks | Stellar Payment Gateway",
  description:
    "View RWA stock prices and oracle data on Stellar Payment Gateway.",
};

export default function StocksPage() {
  return <Oracle />;
}
