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
    <nav aria-label="Primary" className="grid gap-4 p-4 lg:p-5">
      {sections.map((section) => (
        <section
          key={section.key}
          className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
        >
          <div className="mb-2 px-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
              {section.label}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
              {section.description}
            </p>
          </div>

          <div className="space-y-1.5">
            {section.items.map((item) => {
              const isActive = activeHref === item.href;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={[
                    "block rounded-xl border px-3 py-2.5 transition-colors",
                    isActive
                      ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)]"
                      : "border-transparent hover:border-[var(--dpf-border)] hover:bg-[var(--dpf-surface-2)]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={[
                        "text-sm font-semibold",
                        isActive ? "text-[var(--dpf-text)]" : "text-[var(--dpf-text)]",
                      ].join(" ")}
                    >
                      {item.label}
                    </span>
                    {isActive && (
                      <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--dpf-accent)]">
                        Here
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
                    {item.description}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}
