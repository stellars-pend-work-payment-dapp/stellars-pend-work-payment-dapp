import type { Metadata } from "next";
import Swap from "@/features/swap/components/pages/Swap";

export const metadata: Metadata = {
  title: "Swap | Stellar Payment Gateway",
  description: "Swap tokens seamlessly using Stellar Payment Gateway.",
};

export default function SwapPage() {
  return <Swap />;
}
