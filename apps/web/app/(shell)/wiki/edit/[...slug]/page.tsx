// EP-WIKI-001 Phase 6b: wiki page editor route.
// Server component that resolves the page being edited, decides the
// editor mode (create / update / override), and renders the client form.
//
// Modes:
//   - update:   the requesting org already has an overlay row at this slug.
//   - override: the slug only exists as a kernel page; we let the user
//               create an org override that masks the kernel for their org.
//   - create:   no row at this slug anywhere — fresh org-original page.
//
// Kernel rows are never directly editable (spec §4: PR-only); the route
// surfaces the "override in your org" path instead.

import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import {
  WIKI_PAGE_KINDS,
  type WikiPageKind,
  type WikiPageStatus,
} from "@dpf/db/wiki-store";
import { WikiPageEditor } from "@/components/wiki/WikiPageEditor";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string[] }>;

export default async function WikiPageEditRoute({
  params,
}: {
  params: Params;
}) {
  const { slug: slugParts } = await params;
  const slug = slugParts.join("/");

  const organization = await prisma.organization.findFirst({
    select: { id: true },
  });
  if (!organization) {
    // No org row → no overlay scope. Surface a 404 rather than render an
    // editor that would refuse to save.
    notFound();
  }

  // Pass A: overlay row at (org, slug)?
  const overlay = await prisma.wikiPage.findFirst({
    where: { organizationId: organization.id, slug },
    select: {
      id: true,
      slug: true,
      title: true,
      body: true,
      pageKind: true,
      status: true,
      abstract: true,
    },
  });

  if (overlay) {
    return (
      <WikiPageEditor
        mode="update"
        pageId={overlay.id}
        initialSlug={overlay.slug}
        initialTitle={overlay.title}
        initialBody={overlay.body}
        initialPageKind={overlay.pageKind as WikiPageKind}
        initialStatus={overlay.status as WikiPageStatus}
        initialAbstract={overlay.abstract}
        pageKindReadOnly
      />
    );
  }

  // Pass B: kernel row at (NULL, slug)?
  const kernel = await prisma.wikiPage.findFirst({
    where: { organizationId: null, slug, isKernel: true },
    select: {
      id: true,
      slug: true,
      title: true,
      body: true,
      pageKind: true,
      status: true,
      abstract: true,
    },
  });

  if (kernel) {
    return (
      <WikiPageEditor
        mode="override"
        overridesKernelPageId={kernel.id}
        initialSlug={kernel.slug}
        initialTitle={kernel.title}
        initialBody={kernel.body}
        initialPageKind={kernel.pageKind as WikiPageKind}
        initialStatus="draft"
        initialAbstract={kernel.abstract}
        pageKindReadOnly
      />
    );
  }

  // Pass C: no row anywhere — fresh org-original create.
  return (
    <WikiPageEditor
      mode="create"
      initialSlug={slug}
      initialTitle={titleFromSlug(slug)}
      initialBody={defaultBodyForSlug(slug)}
      initialPageKind={pageKindFromSlug(slug)}
      initialStatus="draft"
    />
  );
}

// ─── Slug-driven defaults ───────────────────────────────────────────────────

function titleFromSlug(slug: string): string {
  const stem = slug.split("/").pop() ?? slug;
  return stem
    .split("-")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const PREFIX_TO_KIND: Record<string, WikiPageKind> = {
  entities: "entity",
  stances: "stance",
  heuristics: "heuristic",
  principles: "principle",
  summaries: "summary",
  decisions: "decision",
  runbooks: "runbook",
};

function pageKindFromSlug(slug: string): WikiPageKind {
  const prefix = slug.split("/")[0];
  const kind = PREFIX_TO_KIND[prefix];
  return kind ?? "entity";
}

function defaultBodyForSlug(slug: string): string {
  const kind = pageKindFromSlug(slug);
  switch (kind) {
    case "entity":
      return "## Definition\n\n(authored content goes here)\n\n## Properties\n\n## Relationships\n\n## Source-anchored claims\n\n## Examples\n";
    case "stance":
      return "## Stance\n\n(your one-sentence position)\n\n## Reasoning\n\n## When this applies / when it doesn't\n\n## Sources\n";
    case "heuristic":
      return "## Rule\n\n(when X, do Y)\n\n## Why\n\n## Worked example\n\n## Counterexamples\n";
    case "principle":
      return "## Rule\n\n(one declarative sentence)\n\n## Why\n\n## Applies To\n\n## How To Apply\n\n## Decision Dimensions\n\n## Examples\n\n## Sources\n";
    case "summary":
      return "## Source\n\n## Key claims\n\n## Stance & heuristics extracted\n";
    case "decision":
      return "## Context\n\n## Decision\n\n## Consequences\n\n## Alternatives Considered\n";
    case "runbook":
      return "## When to use\n\n## Prerequisites\n\n## Steps\n\n## Verification\n\n## Rollback\n";
    default:
      return "## Overview\n\n";
  }
}

// Compile-time check: catch a removed page kind early.
void WIKI_PAGE_KINDS;
