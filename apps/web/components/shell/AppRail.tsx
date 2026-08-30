"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PortalAudienceMode, ShellNavSection } from "@/lib/permissions";
import { NAV_MODE_COOKIE } from "@/lib/navigation/nav-mode";
import { InlineBusy } from "@/components/ui/InlineBusy";
import {
  SHELL_TAP_TARGET_CLASS,
  navModeExplanation,
  navModeSwitchAnnouncement,
  navModeToggleAriaLabel,
} from "@/lib/shell/shell-action-contract";

type Props = {
  sections: ShellNavSection[];
  mode?: PortalAudienceMode;
};

function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppRail({ sections, mode = "operator" }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const activeItem = sections
    .flatMap((section) => section.items)
    .filter((item) => matchesPath(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0];
  const activeHref = activeItem?.href;

  // Common Shell Action-Result Contract (BI-9C0954D0 / BI-BF53A701) C2/C3: the
  // Simple/Full toggle must produce a visible result and explain the mode. The
  // pending target drives an immediate "Switching…" affordance while
  // router.refresh() re-resolves the cookie server-side; the live region
  // announces the switch for assistive tech.
  const [pending, setPending] = useState<PortalAudienceMode | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  // Once the server-resolved `mode` prop catches up to the requested value the
  // refresh has landed — clear the pending affordance.
  useEffect(() => {
    setPending(null);
  }, [mode]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // EP-NAV-COHERENCE P4: worker/operator rail mode. "Simple" (worker) hides operator /
  // platform chrome for day-to-day business work; "Full" (operator) restores everything.
  // Operator is the default and is always one click away, so worker mode never strands a
  // user away from a surface their role can reach. Persisted in a cookie the shell reads.
  function setMode(next: PortalAudienceMode) {
    if (next === mode || pending !== null) return;
    setPending(next);
    setAnnouncement(navModeSwitchAnnouncement(next));
    document.cookie = `${NAV_MODE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  const toggleButton = (target: PortalAudienceMode, label: string) => {
    const active = mode === target;
    const busy = pending === target;
    return (
      <button
        type="button"
        onClick={() => setMode(target)}
        aria-pressed={active}
        aria-label={navModeToggleAriaLabel(target)}
        aria-busy={busy}
        disabled={pending !== null}
        className={[
          SHELL_TAP_TARGET_CLASS,
          "flex-1 rounded-md px-2 py-1 transition-colors disabled:cursor-wait",
          active
            ? "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
            : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
        ].join(" ")}
      >
        {busy ? <InlineBusy label="Switching…" size="xs" tone="current" /> : label}
      </button>
    );
  };

  return (
    <nav
      aria-label="Primary"
      data-nav-mode={mode}
      data-audience-mode={mode}
      className="flex flex-col gap-3 p-3 lg:p-4"
    >
      <button
        type="button"
        aria-controls="primary-navigation-menu"
        aria-expanded={mobileOpen}
        aria-label={mobileOpen ? "Close primary navigation" : "Open primary navigation"}
        onClick={() => setMobileOpen((open) => !open)}
        className={[
          SHELL_TAP_TARGET_CLASS,
          "flex w-full items-center justify-between gap-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 text-left text-[var(--dpf-text)] lg:hidden",
        ].join(" ")}
      >
        <span className="min-w-0">
          <span className="text-dpf-caption block font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            Navigation
          </span>
          <span className="block truncate text-sm font-semibold">
            {activeItem?.label ?? "Browse platform"}
          </span>
        </span>
        {mobileOpen ? (
          <ChevronUp aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
        )}
      </button>

      {/* Outside #primary-navigation-menu on purpose. This group used to live
          inside the collapsible menu, which is `hidden` below `lg`, so at
          768px the toggle measured 0x0 with a null offsetParent and the mode
          explanation vanished entirely (BI-6395DA89). The worker Simple mode
          exists for — a kennel technician doing rounds on a tablet — was the
          one worker who could not reach it, and was left looking at Build
          Studio and Admin while recording that a dog had been fed. */}
      <div className="flex flex-col gap-1">
        <div
          role="group"
          aria-label="Navigation detail"
          className="flex items-center gap-1 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-1 text-[11px] font-medium"
        >
          {toggleButton("worker", "Simple")}
          {toggleButton("operator", "Full")}
        </div>
        {/* Persistent, mode-aware explanation of what this view shows (C2/C3). */}
        <p className="px-1 text-[10px] leading-snug text-[var(--dpf-muted)]">
          {navModeExplanation(mode)}
        </p>
        {/* Live region: announces the switch to assistive tech without stealing focus. */}
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
      </div>

      <div
        id="primary-navigation-menu"
        className={[
          mobileOpen ? "flex" : "hidden",
          "flex-col gap-3 lg:flex",
        ].join(" ")}
      >
        <div className="grid min-w-0 gap-3 lg:overflow-visible">
          {sections.map((section) => (
            <section key={section.key} className="min-w-0">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
                {section.label}
              </p>

              <div className="mt-1 grid gap-1">
                {section.items.map((item) => {
                  const isActive = activeHref === item.href;
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => setMobileOpen(false)}
                      className={[
                        SHELL_TAP_TARGET_CLASS,
                        "block min-w-0 rounded-md border px-3 py-2 transition-colors",
                        isActive
                          ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)]"
                          : "border-transparent hover:border-[var(--dpf-border)] hover:bg-[var(--dpf-surface-2)]",
                      ].join(" ")}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="min-w-0 break-words text-sm font-semibold text-[var(--dpf-text)]">
                          {item.label}
                        </span>
                        {isActive && (
                          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--dpf-accent)]">
                            Here
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </nav>
  );
}
