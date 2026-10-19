// apps/web/components/shell/Header.tsx
"use client";

import { ContextualDocsButton } from "@/components/docs/ContextualDocsButton";
import { HeaderFeedbackButton } from "@/components/feedback/HeaderFeedbackButton";
import { PlatformHealthIndicator } from "@/components/monitoring/PlatformHealthIndicator";
import { ShellSignOut } from "@/components/shell/ShellSignOut";
import { useEffect, useRef, useState } from "react";
import { EllipsisVertical } from "lucide-react";
import { Surface } from "@/components/ui/Surface";
import { useT } from "@/lib/i18n/use-t";
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
  /**
   * Pre-formatted badge for a NON-PRODUCTION installation, e.g. `NORTHWIND DEV`
   * — or null on production, which is the unmarked default (BI-7626A660).
   *
   * Resolved on the server and passed in as a plain string. This component must
   * never import the resolver: its siblings reach `node:fs/promises`, and a
   * client graph that touches Node breaks the production build with an error
   * neither typecheck nor vitest surfaces.
   *
   * Marking only the exception is deliberate. A badge that is always present
   * stops being read, and this way a failure to resolve degrades to no badge
   * rather than to a false "PROD".
   */
  installationBadge?: string | null;
  /** Where the badge links for the full identity detail. */
  installationHref?: string;
};

export function Header({ platformRole, brandName, brandLogoUrl, brandLogoUrlLight, userId, navMode = "operator", installationBadge = null, installationHref = "/ops/installation" }: Props) {
  const t = useT("shell");
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
  const [accountOpen, setAccountOpen] = useState(false);
  const accountButton = useRef<HTMLButtonElement>(null);
  const accountPanel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const dismiss = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        if (accountPanel.current?.querySelector('[role="dialog"]')) return;
        setAccountOpen(false);
        accountButton.current?.focus();
      } else if (!accountPanel.current?.contains(event.target as Node) && !accountButton.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [accountOpen]);

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
        {/* The brand link and the installation badge are SIBLINGS, not nested.
            The badge navigates somewhere else, and an anchor inside an anchor is
            invalid HTML that browsers resolve unpredictably. */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <Link
          href="/workspace"
          aria-label={`${companyName} home`}
          className="flex shrink-0 items-center gap-2 sm:gap-3"
        >
          {hasLogo && !logoFailed ? (
            <div className="flex h-10 items-center sm:h-14">
              {hasLightLogo ? (
                <>
                  <img
                    src={logoLight}
                    alt={`${companyName} logo`}
                    className="logo-light block h-full w-auto max-w-20 object-contain sm:max-w-[220px]"
                    onError={() => { setLogoFailed(true); }}
                  />
                  <img
                    src={logoSource}
                    alt={`${companyName} logo`}
                    className="logo-dark block h-full w-auto max-w-20 object-contain sm:max-w-[220px]"
                    onError={() => { setLogoFailed(true); }}
                  />
                </>
              ) : (
                <img
                  src={logoSource}
                  alt={`${companyName} logo`}
                  className="block h-full w-auto max-w-20 object-contain sm:max-w-[220px]"
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
                <span className="block max-w-48 truncate font-extrabold tracking-tight text-sm text-[var(--dpf-accent)] lg:max-w-64">
                  {companyName}
                </span>
              )}
              {!simpleMode && (
                <span className="hidden rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--dpf-muted)] lg:inline">
                  Internal cockpit
                </span>
              )}
            </div>
          </div>
        </Link>

        {/* Non-production only. Stays visible in Simple mode and on small
            screens, unlike the builder chrome above: knowing you are not on
            production is not a builder concern, it is the one fact that stops
            an operator acting on the wrong installation. */}
        {installationBadge ? (
          <Link
            href={installationHref}
            data-testid="installation-badge"
            title={`${installationBadge} installation — open the details`}
            className="min-w-0 break-words rounded-full border border-[var(--dpf-warning)] px-2 py-0.5 text-dpf-caption font-bold uppercase tracking-wider text-[var(--dpf-warning)]"
          >
            {installationBadge}
          </Link>
        ) : null}
        </div>

        <div className="relative flex shrink-0 items-center gap-1 sm:gap-2">
          <PlatformHealthIndicator />
          <span data-agent-launcher-slot="true" className="inline-flex shrink-0 empty:hidden" />
          <button ref={accountButton} type="button" aria-label={t("nav.accountHelp")} aria-expanded={accountOpen} aria-controls="header-account-actions" onClick={() => setAccountOpen(open => !open)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-[var(--dpf-border)] text-[var(--dpf-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] lg:hidden">
            <EllipsisVertical aria-hidden className="h-5 w-5" />
          </button>
          <div ref={accountPanel} className={`${accountOpen ? "block" : "hidden lg:block"} absolute end-0 top-full z-50 mt-2 w-60 max-w-[calc(100vw-2rem)] lg:static lg:mt-0 lg:w-auto lg:max-w-none`}>
          <Surface id="header-account-actions" role="group" aria-label={t("nav.accountHelp")} padding="sm" className="flex flex-col gap-2 shadow-lg lg:flex-row lg:items-center lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <ContextualDocsButton compact />
          <HeaderFeedbackButton userId={userId ?? null} />
          {platformRole !== null && (
            <span className="hidden text-xs text-[var(--dpf-muted)] sm:inline">
              {platformRole}
            </span>
          )}
          <ShellSignOut />
          </Surface>
          </div>
        </div>
      </div>
    </header>
  );
}
