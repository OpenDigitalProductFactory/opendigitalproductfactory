// GET /api/wiki/link-suggest?q=&from= — pages the wiki editor offers after
// `[[` (BI-2F7BE778; spec 2026-10-14 knowledge-linking §7).
//
// `q` is what the author typed after `[[` (two characters at least); `from` is
// the slug of the page being edited, which sets the link direction (R4). The
// editor only writes organization overlays, so the source is that overlay at
// `from`. The reader is a person: organization from the reader seam (fails
// closed on a multi-organization install, R2) and no family filter (R5
// "People"). The `Server-Timing` header carries the time spent, so the 200 ms
// p95 target is measured at the route.
// @exposure authenticated

import { prisma } from "@dpf/db";
import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/error";
import { auth } from "@/lib/auth";
import { PERSON_CORPUS_SCOPE, wikiReaderForCorpusScope } from "@/lib/tak/corpus-read-scope";
import { LINK_QUERY_MIN_LENGTH } from "@/lib/wiki/link-autocomplete";
import { allowedTargetScopes, overlayLinkSourceScope, queryLinkCandidates, selectLinkSuggestions } from "@/lib/wiki/link-suggest";
import { resolveReaderOrganizationId } from "@/lib/wiki/reader-organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY_LENGTH = 120;

export async function GET(request: Request): Promise<Response> {
  const started = performance.now();
  const session = await auth();
  if (!session?.user?.id) return apiErrorResponse("UNAUTHORIZED", "Sign in to search wiki pages.", 401);

  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const fromSlug = (params.get("from") ?? "").trim();
  if (query.length < LINK_QUERY_MIN_LENGTH) return respond([], started);

  const organizationId = await resolveReaderOrganizationId(prisma);
  const reader = wikiReaderForCorpusScope(PERSON_CORPUS_SCOPE, organizationId);
  const source = overlayLinkSourceScope(fromSlug);
  const candidates = await queryLinkCandidates(prisma, {
    query,
    organizationId: reader.organizationId,
    scopes: allowedTargetScopes(source),
  });
  return respond(selectLinkSuggestions(candidates, { reader, source, fromSlug }), started);
}

function respond(suggestions: unknown[], started: number): Response {
  const response = NextResponse.json({ suggestions });
  response.headers.set("Server-Timing", `suggest;dur=${(performance.now() - started).toFixed(1)}`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
