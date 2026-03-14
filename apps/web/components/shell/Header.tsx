// apps/web/components/shell/Header.tsx
"use client";

import { signOutAction } from "@/lib/actions";
import { can, type CapabilityKey } from "@/lib/permissions";
import { NavBar } from "./NavBar";
import { useEffect, useState } from "react";

type Props = {
  platformRole: string | null;
  isSuperuser: boolean;
  brandName: string;
  brandLogoUrl: string | null;
};

const NAV_ITEMS: Array<{ label: string; href: string; capability: CapabilityKey | null }> = [
  { label: "My Workspace", href: "/workspace", capability: null },
  { label: "Portfolio",    href: "/portfolio",  capability: "view_portfolio" },
  { label: "Backlog",      href: "/ops",        capability: "view_operations" },
  { label: "Inventory",    href: "/inventory",  capability: "view_inventory" },
  { label: "EA Modeler",   href: "/ea",         capability: "view_ea_modeler" },
];

export function Header({ platformRole, isSuperuser, brandName, brandLogoUrl }: Props) {
  const visibleItems = NAV_ITEMS.filter(
    (item) => item.capability === null || can({ platformRole, isSuperuser }, item.capability)
  );

  const companyName = brandName.trim().length > 0 ? brandName : "DPF";
  const logoSource = brandLogoUrl?.trim() ?? "";
  const hasLogo = logoSource.length > 0;
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
  }, [logoSource]);

  const initials = () => {
    const words = companyName
      .trim()
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean);

    if (words.length === 0) return "DPF";
    if (words.length === 1) return (words[0] ?? "").slice(0, 2);
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`;
  };

  return (
    <header className="flex items-center justify-between px-4 py-1.5 bg-[var(--dpf-surface-1)] border-b border-[var(--dpf-border)]">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {hasLogo && !logoFailed ? (
            <div className="h-14 flex items-center">
                <img
                  src={logoSource}
                  alt={`${companyName} logo`}
                  className="block h-full w-auto max-w-[220px] object-contain"
                  onError={() => setLogoFailed(true)}
                />
            </div>
          ) : (
            <div className="w-14 h-14 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] overflow-hidden grid place-items-center">
              <span className="text-[10px] font-bold text-[var(--dpf-muted)]">{initials()}</span>
            </div>
          )}
          {(!hasLogo || logoFailed) && (<span className="font-extrabold text-[var(--dpf-accent)] tracking-tight text-sm">{companyName}</span>)}
        </div>
        <NavBar items={visibleItems} />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => document.dispatchEvent(new CustomEvent("toggle-agent-panel"))}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border border-[var(--dpf-accent)] text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)] hover:text-white transition-colors"
        >
          <span>Agent</span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
        </button>
        {platformRole !== null && (
          <span className="text-xs text-[var(--dpf-muted)]">{platformRole}</span>
        )}
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-xs text-[var(--dpf-muted)] hover:text-white transition-colors"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

