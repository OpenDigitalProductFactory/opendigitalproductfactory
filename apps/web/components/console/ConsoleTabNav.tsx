"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getConsoleFamily, CONSOLE_FAMILIES } from "./console-nav";

// The one operator-console secondary nav (EP-NAV-COHERENCE P1). Rendered for both the
// /platform and /admin trees (PlatformTabNav and AdminTabNav re-export it), so the tab
// row is identical across the boundary — only the active family changes. Pairs with the
// global ShellBreadcrumb so location + the way back are always visible.

export function ConsoleTabNav() {
  const pathname = usePathname();
  const activeFamily = getConsoleFamily(pathname);
  const isOperationsMap = pathname === "/platform/ai/operations-map";

  return (
    <div className={isOperationsMap ? "mb-3 space-y-2" : "mb-6 space-y-3"}>
      <div className="flex flex-wrap gap-2 border-b border-[var(--dpf-border)] pb-2">
        {CONSOLE_FAMILIES.map((family) => {
          const isActive = family.key === activeFamily.key;

          return (
            <Link
              key={family.key}
              href={family.href}
              className={[
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/10 text-[var(--dpf-text)]"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
              ].join(" ")}
            >
              {family.label}
            </Link>
          );
        })}
      </div>

      <div className={isOperationsMap ? "space-y-1" : "space-y-2"}>
        <p className={isOperationsMap ? "sr-only" : "text-sm text-[var(--dpf-muted)]"}>
          {activeFamily.description}
        </p>
        <div className="flex flex-wrap gap-2">
          {activeFamily.subItems.map((item) => {
            const isActive =
              item.href === activeFamily.href
                ? pathname === item.href
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  isActive
                    ? "border-[var(--dpf-accent)] text-[var(--dpf-text)]"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
