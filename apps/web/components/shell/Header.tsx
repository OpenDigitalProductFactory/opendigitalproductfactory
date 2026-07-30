// apps/web/components/shell/Header.tsx
"use client";

import { ContextualDocsButton } from "@/components/docs/ContextualDocsButton";
import { HeaderFeedbackButton } from "@/components/feedback/HeaderFeedbackButton";
import { PlatformHealthIndicator } from "@/components/monitoring/PlatformHealthIndicator";
import { ShellSignOut } from "@/components/shell/ShellSignOut";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { PortalAudienceMode } from "@/lib/navigation/portal-navigation-model";
import { isSimpleNavMode } from "@/lib/navigation/nav-mode";

type Props = {
  platformRole: string | null;
  brandName: string;
  brandLogoUrl: string | null;
  brandLogoUrlLight?: string | null;
  userId?: string | null;
  navMode?: PortalAudienceMode;
};

export function Header({ platformRole, brandName, brandLogoUrl, brandLogoUrlLight, userId, navMode = "operator" }: Props) {
  // Common Shell Action-Result Contract (BI-9C0954D0) C6 + Simple-mode delta:
  // in Simple (worker) view the header sheds builder-flavored chrome (the
  // "Internal cockpit" badge and the specialist-team tagline) so the owner sees a
  // calmer header ahead of the route task. Full view restores it.
  const simpleMode = isSimpleNavMode(navMode);
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
      <div className="flex w-full items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-4 sm:py-2.5 lg:px-6">
        <Link
          href="/workspace"
          aria-label={`${companyName} home`}
          className="flex min-w-0 items-center gap-2 sm:gap-3"
        >
          {hasLogo && !logoFailed ? (
            <div className="flex h-10 items-center sm:h-14">
              {hasLightLogo ? (
                <>
                  <img
                    src={logoLight}
                    alt={`${companyName} logo`}
                    className="logo-light block h-full w-auto max-w-[120px] object-contain sm:max-w-[220px]"
                    onError={() => { setLogoFailed(true); }}
                  />
                  <img
                    src={logoSource}
                    alt={`${companyName} logo`}
                    className="logo-dark block h-full w-auto max-w-[120px] object-contain sm:max-w-[220px]"
                    onError={() => { setLogoFailed(true); }}
                  />
                </>
              ) : (
                <img
                  src={logoSource}
                  alt={`${companyName} logo`}
                  className="block h-full w-auto max-w-[120px] object-contain sm:max-w-[220px]"
                  onError={() => {
                    console.warn(`[Header] Logo failed to load: ${logoSource}`);
                    setLogoFailed(true);
                  }}
                />
              )}
            </div>
          ) : (
            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] sm:h-14 sm:w-14">
              <span className="text-[10px] font-bold text-[var(--dpf-muted)]">{initials()}</span>
            </div>
          )}
          <div className="hidden min-w-0 sm:block">
            <div className="flex items-center gap-2">
              {(!hasLogo || logoFailed) && (
                <span className="font-extrabold tracking-tight text-sm text-[var(--dpf-accent)]">
                  {companyName}
                </span>
              )}
              {!simpleMode && (
                <span className="hidden rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--dpf-muted)] lg:inline">
                  Internal cockpit
                </span>
              )}
            </div>
            {!simpleMode && (
              <p className="mt-0.5 hidden truncate text-xs text-[var(--dpf-muted)] lg:block">
                Small employee team, AI coworkers filling in specialist expertise
              </p>
            )}
          </div>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <ContextualDocsButton compact />
          <PlatformHealthIndicator />
          <HeaderFeedbackButton userId={userId ?? null} />
          {platformRole !== null && (
            <span className="hidden text-xs text-[var(--dpf-muted)] sm:inline">
              {platformRole}
            </span>
          )}
          <ShellSignOut />
        </div>
      </div>
    </header>
  );
}
