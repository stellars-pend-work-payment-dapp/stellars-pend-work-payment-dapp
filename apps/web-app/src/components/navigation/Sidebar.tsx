"use client";

import React, { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useWalletType } from "@/hooks/useWalletType";
import { useStellarWallet } from "@/hooks/useStellarWallet";
import { LEGACY_NAV_ITEMS, NAV_ITEMS } from "./sidebarConfig";
import { SidebarLogo } from "./SidebarLogo";
import { NavItem } from "./NavItem";
import { ConnectedCard } from "./ConnectedCard";
import { SetupCard } from "./SetupCard";
import { useRiskAlertContext } from "@/features/borrowing/context/RiskAlertContext";
import { useActivityFeed } from "@/features/activity/hooks/useActivityFeed";
import { clientEnv } from "@/lib/env.client";

/** Nav item whose danger dot reflects an open borrow position in breach. */
const BORROW_HREF = "/borrowing";

export const SIDEBAR_WIDTH = "270px";

const ADMIN_ADDRESS = clientEnv.lendingAdminAddress;

export function Sidebar() {
  const pathname = usePathname();
  const { isStellarConnected, stellarAddress } = useWalletType();
  const { disconnect: disconnectStellar } = useStellarWallet();
  const { hasActiveBreach } = useRiskAlertContext();
  const { unreadCount } = useActivityFeed();

  const isConnected = isStellarConnected;
  const activeAddress = stellarAddress ?? "";

  const visibleItems = useMemo(
    () => (items: typeof NAV_ITEMS | typeof LEGACY_NAV_ITEMS) =>
      items.filter((item) => {
        const adminOnly = "adminOnly" in item && item.adminOnly;
        // Admin link: ONLY show when admin is configured AND connected wallet is admin
        if (adminOnly) {
          return Boolean(ADMIN_ADDRESS && activeAddress === ADMIN_ADDRESS);
        }
        return true;
      }),
    [activeAddress]
  );

  const navItems = visibleItems(NAV_ITEMS);
  const legacyItems = visibleItems(LEGACY_NAV_ITEMS);

  const handleDisconnect = () => {
    void disconnectStellar();
  };

  // Exact-match for the two job routes so `/jobs/new` does not also light up
  // "Jobs"; prefix-match everywhere else so nested routes keep the parent active.
  const EXACT_MATCH = ["/dashboard", "/jobs", "/jobs/new"];

  const isActive = (href: string) =>
    EXACT_MATCH.includes(href)
      ? pathname === href
      : pathname === href || Boolean(pathname?.startsWith(`${href}/`));

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 z-40 h-screen w-[270px] flex-col border-r border-white/5 bg-[#121212]">
      <SidebarLogo />

      <nav className="flex flex-1 flex-col gap-1 px-3 min-h-0 overflow-y-auto">
        {navItems.map(({ label, href, icon }) => (
          <NavItem
            key={href}
            label={label}
            href={href}
            icon={icon}
            isActive={isActive(href)}
            badge={label === "Activity" ? unreadCount : undefined}
          />
        ))}

        {legacyItems.length > 0 ? (
          <>
            <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/35">
              Legacy experiments
            </p>
            {legacyItems.map(({ label, href, icon }) => (
              <NavItem
                key={href}
                label={label}
                href={href}
                icon={icon}
                isActive={isActive(href)}
                showDot={href === BORROW_HREF && hasActiveBreach}
              />
            ))}
          </>
        ) : null}
      </nav>

      <div className="p-4 pt-6 overflow-y-auto">
        {isConnected && activeAddress ? (
          <ConnectedCard
            address={activeAddress}
            onDisconnect={handleDisconnect}
          />
        ) : (
          <SetupCard />
        )}
      </div>
    </aside>
  );
}
