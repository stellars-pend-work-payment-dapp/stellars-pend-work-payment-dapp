import type { Metadata } from "next";

import JobsBoard from "@/features/escrow/components/JobsBoard";

export const metadata: Metadata = {
  title: "Jobs | Stellar Work Escrow",
  description:
    "Browse open work escrows on Stellar, or create a job and lock the payment in a Soroban contract.",
};

export default function JobsPage() {
  return <JobsBoard />;
}
