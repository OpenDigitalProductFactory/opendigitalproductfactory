// apps/web/components/shell/Header.tsx
"use client";

import { signOutAction } from "@/lib/actions";
import { ContextualDocsButton } from "@/components/docs/ContextualDocsButton";
import { HeaderFeedbackButton } from "@/components/feedback/HeaderFeedbackButton";
import { PlatformHealthIndicator } from "@/components/monitoring/PlatformHealthIndicator";
import { useEffect, useState } from "react";
import Link from "next/link";

type Props = {
  platformRole: string | null;
  brandName: string;
  brandLogoUrl: string | null;
  brandLogoUrlLight?: string | null;
  userId?: string | null;
};

export function Header({ platformRole, brandName, brandLogoUrl, brandLogoUrlLight, userId }: Props) {
  const companyName = brandName.trim().length > 0 ? brandName : "DPF";
  const logoSource = brandLogoUrl?.trim() ?? "";
  const hasLogo = logoSource.length > 0;
  const logoLight = brandLogoUrlLight?.trim() ?? "";
  const hasLightLogo = logoLight.length > 0;
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
    <header className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 px-4 py-2.5 lg:px-6">
        <Link href="/workspace" className="flex min-w-0 items-center gap-3">
          {hasLogo && !logoFailed ? (
            <div className="h-14 flex items-center">
              {hasLightLogo ? (
                <>
                  <img
                    src={logoLight}
                    alt={`${companyName} logo`}
                    className="logo-light block h-full w-auto max-w-[220px] object-contain"
                    onError={() => { setLogoFailed(true); }}
                  />
                  <img
                    src={logoSource}
                    alt={`${companyName} logo`}
                    className="logo-dark block h-full w-auto max-w-[220px] object-contain"
                    onError={() => { setLogoFailed(true); }}
                  />
                </>
              ) : (
                <img
                  src={logoSource}
                  alt={`${companyName} logo`}
                  className="block h-full w-auto max-w-[220px] object-contain"
                  onError={() => {
                    console.warn(`[Header] Logo failed to load: ${logoSource}`);
                    setLogoFailed(true);
                  }}
                />
              )}
            </div>
          ) : (
            <div className="w-14 h-14 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] overflow-hidden grid place-items-center">
              <span className="text-[10px] font-bold text-[var(--dpf-muted)]">{initials()}</span>
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {(!hasLogo || logoFailed) && (
                <span className="font-extrabold tracking-tight text-sm text-[var(--dpf-accent)]">
                  {companyName}
                </span>
              )}
              <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
                Internal cockpit
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--dpf-muted)]">
              Small human team, AI coworkers filling in specialist expertise
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <ContextualDocsButton compact />
          <PlatformHealthIndicator />
          <HeaderFeedbackButton userId={userId ?? null} />
          {platformRole !== null && (
            <span className="hidden text-xs text-[var(--dpf-muted)] sm:inline">
              {platformRole}
            </span>
          )}
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-xs text-[var(--dpf-muted)] transition-colors hover:text-[var(--dpf-text)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

