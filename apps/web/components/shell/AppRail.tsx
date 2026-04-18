"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ShellNavSection } from "@/lib/permissions";

type Props = {
  sections: ShellNavSection[];
};

function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppRail({ sections }: Props) {
  const pathname = usePathname();
  const activeHref = sections
    .flatMap((section) => section.items)
    .filter((item) => matchesPath(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;

  return (
    <nav aria-label="Primary" className="grid gap-3 p-3 lg:p-4">
      {sections.map((section) => (
        <section key={section.key}>
          <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            {section.label}
          </p>

          <div className="mt-1 space-y-1">
            {section.items.map((item) => {
              const isActive = activeHref === item.href;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={[
                    "block rounded-lg border px-3 py-2 transition-colors",
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
    </nav>
  );
}
