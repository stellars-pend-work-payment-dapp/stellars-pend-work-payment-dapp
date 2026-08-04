import type { Metadata } from "next";
import Analytics from "@/features/analytics/components/pages/Analytics";

export const metadata: Metadata = {
  title: "Analytics | Stellar Payment Gateway",
  description:
    "Portfolio earnings, NAV history, risk metrics and advanced DeFi analytics for your Stellar positions.",
};

export default function AnalyticsPage() {
  return <Analytics />;
}
