// The platform's OWN technology stack — the tech lifecycle "we are subject to" (BI-6328BCA6 /
// EP-VSL-SURFACE). This is DPF's own runtimes/frameworks, DISTINCT from the discovered customer
// estate (CustomerConfigurationItem) surfaced under /ops/patches. It reuses the canonical Currency
// axis (apps/web/lib/lifecycle.ts) and the tech-currency grammar rather than inventing new state.
//
// Honesty note: current versions are curated from the repo manifests (refresh on upgrade), and
// support/EOL dates are operator-sourced — a component with no recorded date reads as `unsourced`
// (an actionable gap: record a date, or wire an EOL feed such as endoflife.date). We do not
// fabricate EOL dates for versions whose schedule we cannot verify.

import { deriveCurrency, type Currency } from "../lifecycle";

export type PlatformStackCategory = "runtime" | "database" | "framework" | "language" | "tooling";

export type PlatformStackComponent = {
  key: string;
  name: string;
  category: PlatformStackCategory;
  /** Version DPF runs today (curated from the repo manifests; refresh on upgrade). */
  currentVersion: string;
  /** Operator-recorded support/EOL date for this version line; null when not yet sourced. */
  supportEndsAt: string | null;
  referenceUrl: string;
};

/** Curated definition of DPF's own key stack (as of the manifests on this branch). */
export const PLATFORM_STACK: PlatformStackComponent[] = [
  { key: "node", name: "Node.js", category: "runtime", currentVersion: ">=20 (running 26.x)", supportEndsAt: null, referenceUrl: "https://nodejs.org/en/about/previous-releases" },
  { key: "postgres", name: "PostgreSQL", category: "database", currentVersion: "16.x", supportEndsAt: null, referenceUrl: "https://www.postgresql.org/support/versioning/" },
  { key: "nextjs", name: "Next.js", category: "framework", currentVersion: "16.2", supportEndsAt: null, referenceUrl: "https://nextjs.org/blog" },
  { key: "react", name: "React", category: "framework", currentVersion: "19.2", supportEndsAt: null, referenceUrl: "https://react.dev/versions" },
  { key: "typescript", name: "TypeScript", category: "language", currentVersion: "6.0", supportEndsAt: null, referenceUrl: "https://github.com/microsoft/TypeScript/releases" },
  { key: "prisma", name: "Prisma", category: "tooling", currentVersion: "7.9", supportEndsAt: null, referenceUrl: "https://github.com/prisma/prisma/releases" },
  { key: "tailwind", name: "Tailwind CSS", category: "framework", currentVersion: "4.3", supportEndsAt: null, referenceUrl: "https://github.com/tailwindlabs/tailwindcss/releases" },
];

/** A component's currency status is `unsourced` until a support/EOL date is recorded. */
export type StackCurrency = Currency | "unsourced";

export type AssessedStackComponent = PlatformStackComponent & {
  currency: StackCurrency;
  /** Days until support ends (negative = past); null when unsourced. */
  daysUntilEol: number | null;
};

const DAY_MS = 86_400_000;

/**
 * Map each curated component onto the canonical Currency axis. Components without a recorded
 * support/EOL date resolve to `unsourced` rather than a fabricated status.
 */
export function assessPlatformStack(
  now: Date = new Date(),
  stack: readonly PlatformStackComponent[] = PLATFORM_STACK,
): AssessedStackComponent[] {
  return stack.map((component) => {
    if (!component.supportEndsAt) {
      return { ...component, currency: "unsourced" as const, daysUntilEol: null };
    }
    const end = new Date(component.supportEndsAt);
    const currency = deriveCurrency({ supportEndsAt: end, now }) ?? ("unsourced" as const);
    const daysUntilEol = Number.isNaN(end.getTime())
      ? null
      : Math.round((end.getTime() - now.getTime()) / DAY_MS);
    return { ...component, currency, daysUntilEol };
  });
}

/** Currency states that warrant an upgrade action (feed the upgrade roadmap). */
export const ACTIONABLE_CURRENCIES: StackCurrency[] = ["approaching-eol", "unsupported", "end-of-life"];

export function stackCurrencySummary(assessed: readonly AssessedStackComponent[]): Record<StackCurrency, number> {
  const summary: Record<StackCurrency, number> = {
    current: 0,
    "approaching-eol": 0,
    unsupported: 0,
    "end-of-life": 0,
    unsourced: 0,
  };
  for (const c of assessed) summary[c.currency] += 1;
  return summary;
}
