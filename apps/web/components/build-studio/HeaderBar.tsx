"use client";
import { Sun, Moon, Pause, AlertTriangle } from "lucide-react";
import type { BuildSummary } from "./types";

interface Props {
  build: BuildSummary;
  pendingApprovalCount: number;
  otherBuildApprovalCount: number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function HeaderBar({
  build,
  pendingApprovalCount,
  otherBuildApprovalCount,
  theme,
  onToggleTheme,
}: Props) {
  const showApprovals = pendingApprovalCount > 0 || otherBuildApprovalCount > 0;
  const noun = pendingApprovalCount === 1 ? "thing" : "things";
  return (
    <div className="flex items-center gap-3.5 px-[22px] py-3 bg-[var(--dpf-surface-1)] border-b border-[var(--dpf-border)]">
      <div className="flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-lg grid place-items-center bg-[var(--dpf-text)] text-[var(--dpf-bg)] font-extrabold text-[13px] tracking-tight"
          aria-hidden="true"
        >
          DPF
        </div>
        <div className="text-[11px] font-semibold text-[var(--dpf-muted)]">Build Studio</div>
      </div>

      <div className="h-[22px] w-px bg-[var(--dpf-border)]" aria-hidden="true" />

      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14.5px] font-bold tracking-tight text-[var(--dpf-text)]">
            {build.title}
          </span>
          <span className="font-mono text-[11.5px] text-[var(--dpf-muted)] py-px px-2 bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md">
            {build.branch}
          </span>
        </div>
        <div className="text-[12px] text-[var(--dpf-muted)]">
          Requested by {build.requestedBy} · {build.requestedAt}
        </div>
      </div>

      <span className="flex-1" />

      {showApprovals && (
        <button
          type="button"
          aria-label="Pending approvals"
          onClick={() => {
            /* Slice 4: open approvals popover */
          }}
          className="inline-flex items-center gap-2 py-1.5 pl-2 pr-2.5 text-[12.5px] rounded-full border"
          style={{
            background: "color-mix(in srgb, var(--dpf-warning) 12%, var(--dpf-surface-1))",
            borderColor: "color-mix(in srgb, var(--dpf-warning) 35%, var(--dpf-border))",
          }}
        >
          <span
            className="w-[18px] h-[18px] rounded-full grid place-items-center text-[var(--dpf-surface-1)]"
            style={{ background: "var(--dpf-warning)" }}
            aria-hidden="true"
          >
            <AlertTriangle size={11} strokeWidth={2.4} />
          </span>
          {pendingApprovalCount > 0 && (
            <span className="text-[var(--dpf-text)] font-semibold">
              {pendingApprovalCount} {noun} waiting on you
            </span>
          )}
          {pendingApprovalCount > 0 && otherBuildApprovalCount > 0 && (
            <span className="text-[var(--dpf-muted)]">·</span>
          )}
          {otherBuildApprovalCount > 0 && (
            <span className="text-[var(--dpf-muted)]">
              {otherBuildApprovalCount} more across builds
            </span>
          )}
        </button>
      )}

      <button
        type="button"
        aria-label="Toggle theme"
        onClick={onToggleTheme}
        className="p-2 rounded-lg text-[var(--dpf-text-secondary)] hover:bg-[var(--dpf-surface-2)] transition-colors"
      >
        {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      <button
        type="button"
        aria-label="Pause build"
        className="p-2 rounded-lg text-[var(--dpf-text-secondary)] hover:bg-[var(--dpf-surface-2)] transition-colors"
      >
        <Pause size={14} />
      </button>

      <button
        type="button"
        className="px-3 py-1.5 text-[13px] font-semibold rounded-lg bg-[var(--dpf-accent)] text-[var(--dpf-bg)] hover:opacity-90 transition-opacity"
      >
        Approve & ship
      </button>
    </div>
  );
}
