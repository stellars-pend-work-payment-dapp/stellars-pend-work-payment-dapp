import type { ReactNode } from "react";
import type { JobStatus, MilestoneStatus } from "@spg/escrow";

import { cn } from "@/lib/utils";

export const CARD = "rounded-[20px] bg-[#D3D3D3] p-5 text-[#0F0F0F]";
export const CARD_DARK = "rounded-[20px] bg-[#1C1C1C] p-5 text-white";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(CARD, className)}>{children}</div>;
}

type ButtonVariant = "primary" | "secondary" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-[#0F0F0F] text-white hover:bg-[#2A2A2A]",
  secondary: "bg-white/70 text-[#0F0F0F] hover:bg-white",
  danger: "bg-[#B3261E] text-white hover:bg-[#8F1D18]",
};

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
  title,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        BUTTON_STYLES[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className
      )}
    />
  );
}

const JOB_PILL: Record<JobStatus["tag"], string> = {
  Open: "bg-[#8A7CFF]/20 text-[#3B2FA8]",
  Funded: "bg-[#1B7F4D]/20 text-[#12603A]",
  InProgress: "bg-[#0B6FB8]/20 text-[#0A5A94]",
  Disputed: "bg-[#B3261E]/20 text-[#8F1D18]",
  Completed: "bg-[#1B7F4D]/25 text-[#0E4D2E]",
  Cancelled: "bg-black/10 text-black/60",
  Expired: "bg-black/10 text-black/60",
};

export function JobStatusPill({ status }: { status: JobStatus["tag"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
        JOB_PILL[status]
      )}
    >
      {status}
    </span>
  );
}

const MILESTONE_PILL: Record<MilestoneStatus["tag"], string> = {
  Pending: "bg-black/10 text-black/60",
  Submitted: "bg-[#C77700]/25 text-[#8A5200]",
  Approved: "bg-[#1B7F4D]/25 text-[#0E4D2E]",
};

export function MilestoneStatusPill({
  status,
}: {
  status: MilestoneStatus["tag"];
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        MILESTONE_PILL[status]
      )}
    >
      {status}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold">{label}</span>
      {children}
      {hint ? <span className="text-xs opacity-70">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-black/15 bg-white/80 px-3.5 py-2.5 text-sm text-[#0F0F0F] outline-none focus:border-[#0F0F0F]";

export function Notice({
  tone,
  children,
}: {
  tone: "error" | "info" | "success";
  children: ReactNode;
}) {
  const tones = {
    error: "border-[#B3261E]/40 bg-[#B3261E]/10 text-[#7C1811]",
    info: "border-black/15 bg-black/5 text-black/75",
    success: "border-[#1B7F4D]/40 bg-[#1B7F4D]/10 text-[#0E4D2E]",
  } as const;
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn("rounded-xl border px-3.5 py-3 text-sm", tones[tone])}
    >
      {children}
    </div>
  );
}
