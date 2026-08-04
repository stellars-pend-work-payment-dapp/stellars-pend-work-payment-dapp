import type { Metadata } from "next";
import Dashboard from "@/features/dashboard/components/pages/Dashboard";

export const metadata: Metadata = {
  title: "Dashboard | Stellar Payment Gateway",
  description: "Overview of your portfolio, pools, and protocol activity.",
};

export default function DashboardPage() {
  return <Dashboard />;
}
