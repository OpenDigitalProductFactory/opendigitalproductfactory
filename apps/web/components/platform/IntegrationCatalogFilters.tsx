// apps/web/components/platform/IntegrationCatalogFilters.tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const CATEGORIES = [
  "finance", "cms", "cloud", "crm", "communication",
  "developer-tools", "marketing", "ecommerce", "productivity", "uncategorized",
];
const PRICING = ["free", "paid", "freemium", "open-source"];
const READINESS = [
  ["", "Any readiness"],
  ["ready", "Ready"],
  ["available", "Available"],
  ["needs_setup", "Needs setup"],
  ["needs_grant", "Needs grant"],
  ["blocked", "Blocked"],
];
const AGENTS = [
  ["coo", "COO"],
  ["finance-controller", "Finance"],
  ["hr-specialist", "HR"],
  ["customer-advisor", "Customer"],
  ["build-specialist", "Build Studio"],
];

export function IntegrationCatalogFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    startTransition(() => router.push(`?${params.toString()}`));
  }

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <input
        type="search"
        placeholder="Search tools, integrations, or tasks"
        value={searchParams.get("q") ?? ""}
        onChange={(e) => update("q", e.target.value)}
        className="w-72 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)]"
      />
      <select
        value={searchParams.get("category") ?? ""}
        onChange={(e) => update("category", e.target.value)}
        className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
      >
        <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">All categories</option>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
        value={searchParams.get("pricing") ?? ""}
        onChange={(e) => update("pricing", e.target.value)}
        className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
      >
        <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Any pricing</option>
        {PRICING.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select
        value={searchParams.get("readiness") ?? ""}
        onChange={(e) => update("readiness", e.target.value)}
        className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
      >
        {READINESS.map(([value, label]) => (
          <option key={value} value={value} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
            {label}
          </option>
        ))}
      </select>
      <select
        value={searchParams.get("agent") ?? "coo"}
        onChange={(e) => update("agent", e.target.value)}
        className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
      >
        {AGENTS.map(([value, label]) => (
          <option key={value} value={value} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
