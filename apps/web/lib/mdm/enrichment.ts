/**
 * External enrichment proposal (BI-2D435AFC, v1).
 *
 * Commercial MDM enriches records from external sources (D&B/Clearbit-style).
 * DPF v1 stays inside the governed egress boundary: fetch the account's OWN
 * website (already-stored URL, no search), extract title/description
 * signals, and file the proposal as a steward task — enrichment NEVER writes
 * master data directly; a human (or the steward surface) applies it. Callers
 * must hold the external-access gate (web toggle + grant) before invoking.
 */
import { prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export type EnrichmentProposal = {
  accountId: string;
  website: string;
  pageTitle: string | null;
  metaDescription: string | null;
  suggestions: Record<string, string>;
  stewardTaskId: string | null;
};

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 200_000;

function extractTag(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1]?.trim().slice(0, 300) ?? null;
}

/** Fetch the account's stored website and propose enrichment via steward task. */
export async function proposeAccountEnrichment(
  accountId: string,
): Promise<{ ok: true; proposal: EnrichmentProposal } | { ok: false; message: string }> {
  const account = await prisma.customerAccount.findUnique({
    where: { id: accountId },
    select: { id: true, name: true, website: true, industry: true, notes: true, status: true },
  });
  if (!account) return { ok: false, message: "Account not found." };
  if (account.status === "superseded") return { ok: false, message: "Account is a merge tombstone." };
  if (!account.website) {
    return { ok: false, message: "Account has no website to enrich from — add one first." };
  }

  const url = account.website.startsWith("http") ? account.website : `https://${account.website}`;
  let html: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "DPF-MDM-Enrichment/1.0" },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!response.ok) {
      return { ok: false, message: `Website returned ${response.status} — record may be stale.` };
    }
    html = (await response.text()).slice(0, MAX_BYTES);
  } catch (err) {
    const msg = getErrorMessage(err);
    return { ok: false, message: `Could not reach ${url}: ${msg}` };
  }

  const pageTitle = extractTag(html, /<title[^>]*>([^<]+)<\/title>/i);
  const metaDescription =
    extractTag(html, /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ??
    extractTag(html, /<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);

  const suggestions: Record<string, string> = {};
  if (pageTitle && !account.industry) suggestions["notes:site-title"] = pageTitle;
  if (metaDescription) suggestions["notes:site-description"] = metaDescription;

  let stewardTaskId: string | null = null;
  if (Object.keys(suggestions).length > 0) {
    const crypto = await import("crypto");
    const taskId = `STEW-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    try {
      await prisma.mdmStewardTask.upsert({
        where: {
          domain_kind_subjectId_candidateId: {
            domain: "customer-account",
            kind: "stale",
            subjectId: account.id,
            candidateId: "",
          },
        },
        create: {
          taskId,
          domain: "customer-account",
          kind: "stale",
          subjectId: account.id,
          candidateId: "",
          reasons: suggestions,
          note: `Enrichment proposal from ${url}: ${pageTitle ?? metaDescription ?? "site reachable"}`,
        },
        update: {
          reasons: suggestions,
          note: `Enrichment proposal from ${url}: ${pageTitle ?? metaDescription ?? "site reachable"}`,
          status: "open",
        },
      });
      stewardTaskId = taskId;
    } catch (err) {
      console.error("[mdm-enrichment] failed to file steward task", err);
    }
  }

  return {
    ok: true,
    proposal: {
      accountId: account.id,
      website: url,
      pageTitle,
      metaDescription,
      suggestions,
      stewardTaskId,
    },
  };
}
