import {
  LayoutDashboard,
  ArrowLeftRight,
  Landmark,
  BarChart2,
  Settings,
  Shield,
  Banknote,
  Vault,
  TrendingUp,
  PieChart,
  Zap,
  Bell,
  Workflow,
  Briefcase,
  PlusSquare,
} from "lucide-react";

/**
 * The product surface: the Stellar work-payment escrow.
 *
 * Everything a user needs is reachable from here.
 */
export const NAV_ITEMS = [
  { label: "Jobs", href: "/jobs", icon: Briefcase },
  { label: "Create job", href: "/jobs/new", icon: PlusSquare },
  { label: "Activity", href: "/activity", icon: Bell },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

/**
 * Modules inherited from the repository's previous life as a DeFi/RWA dashboards
 * app. They are **not** part of the work-escrow product and are not covered by
 * its documentation, tests or deployment record. They are kept reachable so the
 * existing code keeps working, but they are grouped under a clearly labelled
 * "Legacy experiments" heading so they cannot be mistaken for product features.
 */
export const LEGACY_NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Discover", href: "/discover", icon: BarChart2 },
  { label: "Pools", href: "/pools", icon: Landmark },
  { label: "Swap", href: "/swap", icon: ArrowLeftRight },
  { label: "Borrow", href: "/borrowing", icon: Landmark },
  { label: "Lend", href: "/lending", icon: TrendingUp },
  { label: "Vault", href: "/vaults", icon: Vault },
  { label: "Strategies", href: "/strategies", icon: Workflow },
  { label: "Analytics", href: "/analytics", icon: PieChart },
  { label: "Automation", href: "/automation", icon: Zap },
  { label: "Ramps", href: "/ramps", icon: Banknote },
  { label: "Admin", href: "/dashboard/admin", icon: Shield, adminOnly: true },
] as const;

export const CARD_STYLES = "rounded-[20px] bg-[#D3D3D3] p-5" as const;

export const CARD_BUTTON_STYLES =
  "flex w-full items-center justify-between rounded-full bg-[#0F0F0F] px-5 py-3 text-sm font-semibold text-white cursor-pointer" as const;
