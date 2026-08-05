// UX critique corpus tool pack (BI-52839DEA deliverable 2, EP-UX-SYSTEM §6 L6).
//
// The critique corpus is the gating asset of the whole UX-quality program: an
// ungrounded design judge is the UICrit zero-shot case, measured at 13.1% valid
// comments, and the corpus — not the model — is what fixes that. Its accrual
// rate, not its start date, decides when the critic can be trusted to gate.
//
// Until now the only door into it was a server action on the portal, so a
// review happening in an external session (Claude Code / Codex / Grok) produced
// nothing durable. Every founder review before capture exists is value
// permanently lost — which is exactly how the EP-UX-COGLOAD wave ended up
// text-only, its screenshots ephemeral browser views that were never persisted.
//
// AUTHORITY, ENFORCED HERE AND NOT MERELY DOCUMENTED. An MCP caller is ALWAYS
// treated as an agent, whatever it claims: `callerKind` is pinned to "agent" at
// this boundary rather than read from params, so a captured entry can only ever
// carry `verdictAuthority: "agent-proposed"`, which `isCalibrationEligible`
// excludes. Founder and designer verdicts stay a human act performed in the
// portal. A judge calibrated on agent-authored verdicts is calibrated against
// itself, so this is a correctness boundary, not a permissions nicety.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "capture_ux_critique",
    description:
      "Record a UX critique of a specific screen into the design critique corpus, as a DRAFT for human review. Use when you have looked at a real surface — during a review, a redesign, or a bug repro — and have a concrete finding worth keeping. Captures the route, the lens the finding is argued under, and the evidence needed to reconstruct the screen later. You may PROPOSE a verdict; only a founder or designer can attach one, and only proposals you did not author become calibration data.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short title for the finding, e.g. 'Skills catalog buries every description'.",
        },
        route: {
          type: "string",
          description: "The route the screen was captured from, e.g. '/platform/ai/skills'.",
        },
        finding: {
          type: "string",
          description:
            "What is wrong (or right) about this screen, in concrete terms. Name what the reader meets and what it costs them — not a rule restated.",
        },
        lens: {
          type: "string",
          enum: ["hierarchy", "density", "hick", "fitts", "miller", "doherty"],
          description:
            "The lens the finding is argued under. Evidence first; the lens explains why it matters.",
        },
        proposedVerdict: {
          type: "string",
          enum: ["change-needed", "no-change-needed", "accepted-debt"],
          description:
            "Optional. Your PROPOSED verdict. Recorded as 'agent-proposed' and never calibration-eligible until a founder or designer attaches their own. Negative entries ('no-change-needed') are calibration data too — capture them.",
        },
        screenshotRef: {
          type: "string",
          description:
            "Reference to the captured image. A critique of a screen nobody can look at again is not reviewable, so an entry without one cannot become calibration data.",
        },
        gitRef: {
          type: "string",
          description:
            "The commit the screen was rendered at. Without it a before/after pair cannot be reconstructed later — the failure that left the earlier cognitive-load findings text-only.",
        },
        viewportWidth: {
          type: "number",
          description: "Viewport width in CSS px at capture (390 = mobile band, 1280 = desktop).",
        },
        colorScheme: { type: "string", enum: ["light", "dark"] },
      },
      required: ["title", "route", "finding", "lens"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "search_ux_critique_corpus",
    description:
      "Read the design critique corpus — past findings about real screens, with their verdicts. Use BEFORE offering a UX opinion so the judgement is grounded in what this product's design authority has actually decided, rather than generic web-craft advice. Returns entries with their route, lens, finding, verdict and whether that verdict is calibration-eligible.",
    inputSchema: {
      type: "object",
      properties: {
        route: {
          type: "string",
          description: "Filter to critiques of one route, e.g. '/platform/ai/skills'.",
        },
        lens: {
          type: "string",
          enum: ["hierarchy", "density", "hick", "fitts", "miller", "doherty"],
          description: "Filter to one lens.",
        },
        calibratedOnly: {
          type: "boolean",
          description:
            "When true, return ONLY entries carrying a founder/designer verdict — the calibration set. Use this when grounding a judgement; agent-proposed entries are not evidence of what the design authority thinks.",
        },
        limit: { type: "number", description: "Max entries to return (default 20)." },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
];

const CRITIQUE_SLUG_PREFIX = "craft/ux-design/";

async function captureUxCritique(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { captureCritiqueEntry } = await import("@/lib/actions/critique-entry");

  const str = (k: string): string | undefined => {
    const v = params[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const num = (k: string): number | undefined =>
    typeof params[k] === "number" ? (params[k] as number) : undefined;

  const title = str("title");
  const route = str("route");
  const finding = str("finding");
  const lens = str("lens");
  if (!title || !route || !finding || !lens) {
    return {
      success: false,
      error: "invalid_params",
      message: "Provide title, route, finding and lens.",
    };
  }

  const proposedVerdict = str("proposedVerdict");
  const colorScheme = str("colorScheme");

  const result = await captureCritiqueEntry({
    title,
    // PINNED, never read from params. See the authority note in the header.
    callerKind: "agent",
    route,
    finding,
    lenses: [lens as never],
    ...(proposedVerdict
      ? { verdict: proposedVerdict as never, verdictAuthority: "agent-proposed" as const }
      : {}),
    screenshotRef: str("screenshotRef") ?? null,
    gitRef: str("gitRef") ?? str("commitSha") ?? null,
    viewportWidth: num("viewportWidth") ?? null,
    colorScheme: (colorScheme as "light" | "dark" | undefined) ?? null,
  });

  if (!result.ok) {
    return { success: false, error: "capture_rejected", message: result.error };
  }

  return {
    success: true,
    entityId: result.slug,
    message:
      `Captured as a draft at ${result.slug}. It is not calibration data until a founder or ` +
      `designer attaches their own verdict in the portal.`,
    data: {
      slug: result.slug,
      status: result.status,
      screenshotAttached: result.screenshotAttached ?? null,
      verdictAuthority: proposedVerdict ? "agent-proposed" : null,
      calibrationEligible: false,
    },
  };
}

async function searchUxCritiqueCorpus(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const { critiqueEntryFromWikiPage, isCalibrationEligible } = await import(
    "@/lib/ux-critique/critique-entry"
  );

  const routeFilter = typeof params["route"] === "string" ? params["route"] : null;
  const lensFilter = typeof params["lens"] === "string" ? params["lens"] : null;
  const calibratedOnly = params["calibratedOnly"] === true;
  const limit = Math.min(
    Math.max(typeof params["limit"] === "number" ? params["limit"] : 20, 1),
    100,
  );

  const pages = await prisma.wikiPage.findMany({
    where: { slug: { startsWith: CRITIQUE_SLUG_PREFIX } },
    select: { slug: true, title: true, body: true, status: true, metadata: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  const entries = pages
    .map((page) => ({ page, entry: critiqueEntryFromWikiPage(page) }))
    .filter((row): row is { page: (typeof pages)[number]; entry: NonNullable<typeof row.entry> } =>
      Boolean(row.entry),
    )
    .filter((row) => (routeFilter ? row.entry.route === routeFilter : true))
    .filter((row) => (lensFilter ? row.entry.lenses.includes(lensFilter as never) : true))
    .filter((row) => (calibratedOnly ? isCalibrationEligible(row.entry) : true))
    .slice(0, limit);

  // An empty corpus is a REAL and important answer here — it means any design
  // judgement offered is ungrounded — so say so rather than returning a bare
  // empty list the caller might read as "nothing relevant".
  const message = entries.length
    ? `${entries.length} critique entr${entries.length === 1 ? "y" : "ies"}.`
    : calibratedOnly
      ? "No calibration-eligible critiques yet: the corpus holds no founder/designer verdicts, so any design judgement here is ungrounded. Say so rather than asserting a verdict."
      : "The critique corpus is empty. Any design judgement here is ungrounded — say so, and capture what you observe so the corpus starts accruing.";

  return {
    success: true,
    message,
    data: {
      total: entries.length,
      // The fail-loud signal lives in DATA, not only in `message`. Verified
      // 2026-08-04 against the deployed tool: an empty corpus came back as a
      // bare `{total: 0, entries: []}` because this client surfaces `data` and
      // drops `message` — so the one sentence that stops a caller treating
      // silence as "nothing relevant" never arrived. A warning a client can
      // discard is not a warning.
      grounding:
        entries.length > 0
          ? "grounded"
          : "UNGROUNDED — no matching critique entries. Any design judgement offered here is not backed by this product's design authority. Say so explicitly rather than asserting a verdict, and capture what you observe so the corpus starts accruing.",
      entries: entries.map(({ page, entry }) => ({
        slug: page.slug,
        title: page.title,
        status: page.status,
        route: entry.route,
        lenses: entry.lenses,
        finding: entry.finding,
        verdict: entry.verdict ?? null,
        verdictAuthority: entry.verdictAuthority ?? null,
        calibrationEligible: isCalibrationEligible(entry),
        gitRef: entry.gitRef ?? null,
        screenshotRef: entry.screenshotRef ?? null,
      })),
    },
  };
}

export const uxCritiquePack: ToolPack = {
  packId: "ux-critique",
  definitions,
  handlers: {
    capture_ux_critique: (params) => captureUxCritique(params),
    search_ux_critique_corpus: (params) => searchUxCritiqueCorpus(params),
  },
  // Mirrors TOOL_TO_GRANTS, which stays the gating source; tool-registry.test.ts
  // asserts the two never drift. A pack that advertises a grant the gating map
  // does not carry is DENIED for every coworker while looking authoritative —
  // the BI-88B77204 failure.
  //
  // Capture takes its OWN narrow grant rather than `registry_write`: the
  // coding-agent (`development`) token holds registry_read but not
  // registry_write, so shipping on the broad grant made this tool unreachable
  // from the external review sessions it exists for. Search is read-only and
  // advisory, like the WWMD/WSID gates.
  grants: {
    capture_ux_critique: ["critique_capture"],
    search_ux_critique_corpus: ["registry_read"],
  },
};
