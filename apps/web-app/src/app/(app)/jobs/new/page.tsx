import type { Metadata } from "next";

import CreateJobForm from "@/features/escrow/components/CreateJobForm";

export const metadata: Metadata = {
  title: "Create a job | Stellar Work Escrow",
  description:
    "Define milestones and a deadline, then escrow the payment in a Soroban contract.",
};

export default function NewJobPage() {
  return <CreateJobForm />;
}
