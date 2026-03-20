// apps/web/components/platform/IntegrationCatalogFilters.tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const CATEGORIES = [
  "finance", "cms", "cloud", "crm", "communication",
  "developer-tools", "marketing", "ecommerce", "productivity", "uncategorized",
];
const PRICING = ["free", "paid", "freemium", "open-source"];

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
        placeholder="Search integrations…"
        value={searchParams.get("q") ?? ""}
        onChange={(e) => update("q", e.target.value)}
        className="border rounded px-3 py-1.5 text-sm w-56"
      />
      <select
        value={searchParams.get("category") ?? ""}
        onChange={(e) => update("category", e.target.value)}
        className="border rounded px-3 py-1.5 text-sm"
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
        value={searchParams.get("pricing") ?? ""}
        onChange={(e) => update("pricing", e.target.value)}
        className="border rounded px-3 py-1.5 text-sm"
      >
        <option value="">Any pricing</option>
        {PRICING.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );
}
