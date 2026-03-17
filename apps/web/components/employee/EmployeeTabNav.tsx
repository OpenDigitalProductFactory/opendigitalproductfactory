"use client";

import { useSearchParams, useRouter } from "next/navigation";

const TABS = [
  { label: "Directory", value: "directory" },
  { label: "Org Chart", value: "orgchart" },
] as const;

export type EmployeeTab = (typeof TABS)[number]["value"];

export function EmployeeTabNav() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentTab = searchParams.get("view") ?? "directory";

  function handleClick(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "directory") {
      params.delete("view");
    } else {
      params.set("view", value);
    }
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "/employee", { scroll: false });
  }

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--dpf-border)]">
      {TABS.map((t) => (
        <button
          key={t.value}
          onClick={() => handleClick(t.value)}
          className={[
            "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
            currentTab === t.value
              ? "text-white border-b-2 border-[var(--dpf-accent)]"
              : "text-[var(--dpf-muted)] hover:text-white",
          ].join(" ")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
