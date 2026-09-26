"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";
import { useT } from "@/lib/i18n/use-t";

type Action = { href: string; label: string };

function NotFoundShell({
  heading,
  body,
  primary,
  secondary,
}: {
  heading: string;
  body: string;
  primary: Action;
  secondary?: Action;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--dpf-bg)] px-4 py-10">
      <div className="w-full max-w-[34rem] rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center sm:p-8">
        <div
          aria-hidden="true"
          className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-base font-semibold text-[var(--dpf-accent)]"
        >
          404
        </div>
        <h1 className="mb-2 text-lg font-semibold text-[var(--dpf-text)]">{heading}</h1>
        <p className="mb-5 text-sm leading-6 text-[var(--dpf-muted)]">{body}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href={primary.href}
            className="rounded-lg bg-[var(--dpf-accent)] px-5 py-2 text-sm font-medium text-white"
          >
            {primary.label}
          </Link>
          {secondary && (
            <Link
              href={secondary.href}
              className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-5 py-2 text-sm font-medium text-[var(--dpf-text)]"
            >
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Global not-found boundary. Only reached when no more specific route-segment
 * `not-found.tsx` claimed the miss (e.g. `(storefront)/s/[slug]/not-found.tsx`
 * or `(storefront)/s/not-found.tsx` for the public storefront) — which mainly
 * means genuinely internal shell routes, PLUS two public cases that have no
 * matching segment at all to hang a nested boundary off of (BI-B9D54962):
 *
 * 1. A source-registered archetype (packages/storefront-templates) that has
 *    not been provisioned into live routing yet, e.g. `/third-party-logistics`
 *    for Warehousing & Fulfilment — a public prospect hitting this should be
 *    told the demo isn't generated yet, not sent to the internal workspace.
 * 2. Any other unrecognized top-level path under the public `/s/…` prefix
 *    that somehow reaches here rather than a nested boundary.
 *
 * Everything else keeps the existing operator-oriented recovery — those are
 * internal Workspace/Docs/Platform/Admin routes where "back to workspace" is
 * the correct fallback for a signed-in operator who mistyped a URL.
 */
export default function NotFound() {
  const t = useT("errors");
  const pathname = usePathname() ?? "";
  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0] ?? "";

  const unprovisionedArchetype =
    segments.length === 1
      ? ALL_ARCHETYPES.find((a) => a.archetypeId === firstSegment)
      : undefined;

  if (unprovisionedArchetype) {
    return (
      <NotFoundShell
        heading={t("notFound.demoPending.heading")}
        body={t("notFound.demoPending.body", { name: unprovisionedArchetype.name })}
        primary={{ href: "/", label: t("notFound.demoPending.primary") }}
      />
    );
  }

  if (firstSegment === "s") {
    return (
      <NotFoundShell
        heading={t("notFound.storefront.heading")}
        body={t("notFound.storefront.body")}
        primary={{ href: "/", label: t("notFound.storefront.primary") }}
      />
    );
  }

  return (
    <NotFoundShell
      heading={t("notFound.workspace.heading")}
      body={t("notFound.workspace.body")}
      primary={{ href: "/workspace", label: t("notFound.workspace.primary") }}
      secondary={{ href: "/docs", label: t("notFound.workspace.secondary") }}
    />
  );
}
