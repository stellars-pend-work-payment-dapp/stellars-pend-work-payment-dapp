import type { Metadata } from "next";
import { notFound } from "next/navigation";

import JobDetailView from "@/features/escrow/components/JobDetailView";

export const metadata: Metadata = {
  title: "Job details | Stellar Work Escrow",
  description:
    "Escrow status, milestones, dispute handling and payment release for a single job.",
};

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const jobId = Number(id);

  // Job ids are positive integers; anything else cannot exist on chain.
  if (!Number.isInteger(jobId) || jobId <= 0) notFound();

  return <JobDetailView jobId={jobId} />;
}
