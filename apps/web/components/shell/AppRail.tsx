"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { PortalAudienceMode, ShellNavSection } from "@/lib/permissions";
import { NAV_MODE_COOKIE } from "@/lib/navigation/nav-mode";

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
  const activeHref = sections
    .flatMap((section) => section.items)
    .filter((item) => matchesPath(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;

  // EP-NAV-COHERENCE P4: worker/operator rail mode. "Simple" (worker) hides operator /
  // platform chrome for day-to-day business work; "Full" (operator) restores everything.
  // Operator is the default and is always one click away, so worker mode never strands a
  // user away from a surface their role can reach. Persisted in a cookie the shell reads.
  function setMode(next: PortalAudienceMode) {
    if (next === mode) return;
    document.cookie = `${NAV_MODE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <nav aria-label="Primary" data-nav-mode={mode} className="flex flex-col gap-3 p-3 lg:p-4">
      <div
        role="group"
        aria-label="Navigation detail"
        className="flex items-center gap-1 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-1 text-[11px] font-medium"
      >
        <button
          type="button"
          onClick={() => setMode("worker")}
          aria-pressed={mode === "worker"}
          className={[
            "flex-1 rounded-md px-2 py-1 transition-colors",
            mode === "worker"
              ? "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
              : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
          ].join(" ")}
        >
          Simple
        </button>
        <button
          type="button"
          onClick={() => setMode("operator")}
          aria-pressed={mode === "operator"}
          className={[
            "flex-1 rounded-md px-2 py-1 transition-colors",
            mode === "operator"
              ? "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
              : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
          ].join(" ")}
        >
          Full
        </button>
      </div>

      {/* BI-882B3680: on mobile the rail wraps instead of forcing a single wide
          horizontal-scroll row, so a phone-width viewport (390px) never overflows
          the page. Desktop keeps the vertical grid rail. */}
      <div className="flex min-w-0 flex-wrap gap-3 lg:grid lg:overflow-visible">
        {sections.map((section) => (
          <section key={section.key} className="min-w-0">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
              {section.label}
            </p>

            <div className="mt-1 flex flex-wrap gap-1 lg:block lg:space-y-1">
              {section.items.map((item) => {
                const isActive = activeHref === item.href;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={[
                      "block whitespace-nowrap rounded-lg border px-3 py-2 transition-colors",
                      isActive
                        ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)]"
                        : "border-transparent hover:border-[var(--dpf-border)] hover:bg-[var(--dpf-surface-2)]",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-[var(--dpf-text)]">
                        {item.label}
                      </span>
                      {isActive && (
                        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--dpf-accent)]">
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
    </nav>
  );
}
