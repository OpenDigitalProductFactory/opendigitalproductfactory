// Public-web + brand + design-intelligence tool pack — BI-2B7EE073.
//
// Drains the self-contained "public web, brand extraction, and design
// intelligence" domain out of the mcp-tools.ts executeTool switch: the eight
// tools a coworker uses to search the public web and fetch pages, derive/extract
// brand and design systems from a site, codebase, or uploaded assets, evaluate a
// live page for UX/accessibility, and look up design-intelligence
// recommendations. Each handler lazy- or statically-imports the same service the
// former switch case used and reproduces its body verbatim, so behaviour is
// identical when the tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { CapabilityKey } from "@/lib/permissions";
import {
  analyzePublicWebsiteBranding,
  fetchPublicWebsiteEvidence,
  searchPublicWeb,
} from "@/lib/public-web-tools";
import { activeBrandExtractionWhere } from "@/lib/brand/active-extraction";
import { recordExternalEvidence } from "@/lib/actions/external-evidence";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "search_public_web",
    description: "Search the public web for relevant pages or facts",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    requiredCapability: null,
    requiresExternalAccess: true,
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate"],
  },
  {
    name: "fetch_public_website",
    description: "Fetch a public website and summarize visible branding and metadata",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public http or https URL" },
      },
      required: ["url"],
    },
    requiredCapability: null,
    requiresExternalAccess: true,
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate"],
  },
  {
    name: "analyze_public_website_branding",
    description: "Analyze a public website and propose branding values such as company name, logo, and accent color",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public http or https URL" },
      },
      required: ["url"],
    },
    requiredCapability: "manage_branding",
    requiresExternalAccess: true,
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "extract_brand_design_system",
    description: "Kick off a background brand extraction for the organization. Reads any combination of a public website URL, the platform codebase, and uploaded brand assets, merges them into a BrandDesignSystem (palette, typography, component inventory, tokens), and writes the result to Organization.designSystem. Returns a taskRunId immediately; progress is streamed through the agent panel and the coworker re-surfaces with a summary when done. Use when the user asks to refresh the brand, build a design system, or analyze an existing site.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public http or https URL to extract brand signals from." },
        includeCodebase: { type: "boolean", description: "When true, also read the installed platform codebase for tokens. Defaults to false." },
        uploadIds: { type: "array", items: { type: "string" }, description: "IDs of AgentAttachment records to include (logos, brand kit PDFs, style decks)." },
      },
    },
    requiredCapability: "manage_branding",
    requiresExternalAccess: true,
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "evaluate_page",
    description:
      "Evaluate a live page for UX and accessibility issues using AI-powered browser automation (browser-use). " +
      "Navigates to the page, analyzes layout, interactions, and accessibility, and returns structured findings. " +
      "Requires the browser-use sidecar (BROWSER_USE_URL, default http://browser-use:8500/mcp) and a reachable target URL. " +
      "If success=false with DEGRADED / NOT-RUN / connection error: do NOT retry the same call — check sidecar health " +
      "(GET /health/capability), confirm the URL is reachable from the browser-use container (not host-only localhost), " +
      "and fall back to code-only review (read the route component + theme tokens) instead of looping. " +
      "Works on production pages (default) or sandbox pages when an absolute URL is provided.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "Absolute URL to evaluate (e.g. http://portal:3000/workspace or https://…/route). " +
            "Defaults to the current route only when routeContext is set; bare paths without a host fail. " +
            "Inside Docker, use the service hostname — not Windows/macOS localhost.",
        },
      },
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["review"],
  },
  {
    name: "search_design_intelligence",
    description: "Search design intelligence for source-cited UI/UX guidance and operational precedents, including styles, colors, typography, UX practices, landing patterns, charts, product recommendations, and physical-workspace patterns.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords (e.g., 'SaaS dashboard', 'glassmorphism dark mode', 'elegant luxury serif')" },
        domain: {
          type: "string",
          enum: ["style", "color", "typography", "ux", "landing", "chart", "product", "reasoning", "precedent"],
          description: "Which design domain to search: style, color, typography, ux, landing, chart, product, reasoning, or precedent (source-cited physical operational workspace patterns)",
        },
        max_results: { type: "number", description: "Maximum results to return (default 5)" },
      },
      required: ["query", "domain"],
    },
    requiredCapability: null, // Read-only design reference — no capability gate
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review"],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "generate_design_system",
    description: "Generate a complete design system recommendation for a product. Searches across product types, styles, colors, typography, and landing page patterns, then applies industry-specific reasoning rules. Returns: recommended pattern, style, color palette, font pairing, effects, anti-patterns to avoid, and a pre-delivery checklist. This is a pure data lookup — no LLM call, works at any model tier.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product description and keywords (e.g., 'beauty spa wellness service', 'fintech banking dashboard', 'SaaS analytics tool')" },
        project_name: { type: "string", description: "Optional project name for the design system header" },
      },
      required: ["query"],
    },
    requiredCapability: null, // Read-only design reference — no capability gate
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review"],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "analyze_brand_document",
    description: "Analyze an uploaded brand guidelines document (PDF or image) and extract brand assets: logo, colors, and fonts",
    inputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Original filename" },
        fileContent: { type: "string", description: "Base64-encoded file content" },
        fileType: { type: "string", enum: ["pdf", "png", "jpg", "svg"], description: "File type" },
      },
      required: ["fileName", "fileContent", "fileType"],
    },
    requiredCapability: "manage_branding" as CapabilityKey,
    executionMode: "immediate",
  },
];

async function searchPublicWebHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string },
): Promise<ToolResult> {
  const query = String(params["query"] ?? "").trim();
  let results: Awaited<ReturnType<typeof searchPublicWeb>>;
  try {
    results = await searchPublicWeb(query);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Web search failed";
    return { success: false, error: msg, message: msg };
  }
  if (context?.routeContext) {
    await recordExternalEvidence({
      actorUserId: userId,
      routeContext: context.routeContext,
      operationType: "public_web_search",
      target: query,
      provider: "brave_search",
      resultSummary: `Found ${results.length} public search result(s)`,
      details: results as import("@dpf/db").Prisma.InputJsonValue,
    });
  }
  return {
    success: true,
    message: results.length > 0
      ? `Found ${results.length} public search result(s). Top result: ${results[0]!.title} (${results[0]!.url})`
      : "No public search results were found.",
    data: { results },
  };
}

async function fetchPublicWebsiteHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string },
): Promise<ToolResult> {
  const url = String(params["url"] ?? "").trim();
  const evidence = await fetchPublicWebsiteEvidence(url);
  if (context?.routeContext) {
    await recordExternalEvidence({
      actorUserId: userId,
      routeContext: context.routeContext,
      operationType: "public_web_fetch",
      target: evidence.finalUrl,
      provider: "public_fetch",
      resultSummary: `Fetched public website evidence for ${evidence.finalUrl}`,
      details: evidence as unknown as import("@dpf/db").Prisma.InputJsonValue,
    });
  }
  return {
    success: true,
    message: `Fetched ${evidence.finalUrl}${evidence.title ? ` (${evidence.title})` : ""}.`,
    data: evidence,
  };
}

async function analyzePublicWebsiteBrandingHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string },
): Promise<ToolResult> {
  const url = String(params["url"] ?? "").trim();
  const evidence = await fetchPublicWebsiteEvidence(url);
  const branding = analyzePublicWebsiteBranding(evidence);
  if (context?.routeContext) {
    await recordExternalEvidence({
      actorUserId: userId,
      routeContext: context.routeContext,
      operationType: "branding_analysis",
      target: evidence.finalUrl,
      provider: "public_fetch",
      resultSummary: `Derived branding proposal for ${evidence.finalUrl}`,
      details: {
        evidence,
        branding,
      } as import("@dpf/db").Prisma.InputJsonValue,
    });
  }
  return {
    success: true,
    message: `Derived branding suggestions for ${branding.companyName ?? evidence.finalUrl}.`,
    data: {
      companyName: branding.companyName,
      logoUrl: branding.logoUrl,
      paletteAccent: branding.paletteAccent,
      notes: branding.notes,
    },
  };
}

async function extractBrandDesignSystemHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; threadId?: string },
): Promise<ToolResult> {
  // Resolve THE single Organization (single-org-per-install architecture;
  // see memory project_single_org_per_install). No explicit org id is
  // threaded through executeTool, and there's only one Org per DPF install.
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return {
      success: false,
      message: "Could not resolve an organization. Complete Setup first.",
      error: "Could not resolve an organization. Complete Setup first.",
    };
  }

  // Concurrency guard (AD-7): return early if another extraction is already
  // running for this user, so the coworker doesn't fire duplicate jobs.
  const active = await prisma.taskRun.findFirst({
    where: activeBrandExtractionWhere(userId),
    select: { taskRunId: true },
  });
  if (active) {
    return {
      success: true,
      message: "An extraction is already running — I'll ping you when it finishes.",
      data: { taskRunId: active.taskRunId, status: "already-in-progress" },
    };
  }

  const url = typeof params["url"] === "string" && params["url"].trim().length > 0
    ? String(params["url"]).trim()
    : undefined;
  const includeCodebase = params["includeCodebase"] === true;
  const uploadIdsRaw = params["uploadIds"];
  const uploadIds = Array.isArray(uploadIdsRaw)
    ? uploadIdsRaw.filter((id): id is string => typeof id === "string")
    : undefined;

  // DPF is single-org-per-install, so the installed org can always read
  // the local platform codebase when includeCodebase is requested.
  const codebasePath = includeCodebase ? "/app" : undefined;

  if (!url && !codebasePath && (!uploadIds || uploadIds.length === 0)) {
    return {
      success: false,
      message: "Provide at least one source: a URL, includeCodebase, or uploadIds.",
      error: "Provide at least one source: a URL, includeCodebase, or uploadIds.",
    };
  }

  const taskRunId = `TR-BRAND-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.taskRun.create({
    data: {
      taskRunId,
      userId,
      threadId: context?.threadId ?? null,
      routeContext: context?.routeContext ?? null,
      title: "Extract brand design system",
      objective: url
        ? `Extract brand from ${url}`
        : "Extract brand from supplied sources",
      source: "coworker",
      status: "active",
    },
  });

  const { inngest } = await import("@/lib/queue/inngest-client");
  await inngest.send({
    name: "brand/extract.run",
    data: {
      organizationId: org.id,
      taskRunId,
      userId,
      threadId: context?.threadId ?? null,
      sources: { url, codebasePath, uploadIds },
    },
  });

  return {
    success: true,
    message: "Working on it — I'll ping you when the brand is ready.",
    data: { taskRunId, status: "queued" },
  };
}

async function evaluatePageHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string },
): Promise<ToolResult> {
  const url = typeof params["url"] === "string" ? params["url"] : null;
  const targetUrl = url || (context?.routeContext ? `http://localhost:3000${context.routeContext}` : null);
  if (!targetUrl) {
    return {
      success: false,
      error: "missing_url",
      // BI-MCP-EFF-71D7229F: fail with a non-retryable contract message so agents
      // do not loop the same call (97% historical failure was blind retry).
      message:
        "evaluate_page needs an absolute URL (or a portal routeContext). " +
        "Do not retry without a URL. Fall back to reading the route source for a code-only UX review.",
    };
  }

  try {
    const BROWSER_USE_URL = process.env.BROWSER_USE_URL || "http://browser-use:8500/mcp";

    // Use browser-use to evaluate the page with AI-powered analysis
    let extractRes: Response;
    try {
      extractRes = await fetch(BROWSER_USE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "browse_open",
            arguments: { url: targetUrl },
          },
        }),
        signal: AbortSignal.timeout(60000),
      });
    } catch (connectError) {
      const reason = getErrorMessage(connectError);
      return {
        success: false,
        error: "browser_use_unavailable",
        message:
          `evaluate_page could not reach browser-use at ${BROWSER_USE_URL}: ${reason}. ` +
          "Do NOT retry the same call — the sidecar is down or unreachable from this runtime. " +
          "Check BROWSER_USE_URL and GET /health/capability; fall back to code-only review.",
        data: { url: targetUrl, browserUseUrl: BROWSER_USE_URL, retryable: false },
      };
    }
    const openResult = await extractRes.json();
    const openContent = JSON.parse(openResult?.result?.content?.[0]?.text ?? "{}");
    const sessionId = openContent.session_id;
    if (!sessionId) {
      return {
        success: false,
        error: "browser_session_open_failed",
        message:
          "evaluate_page could not open a browser session (no session_id). " +
          "Do NOT retry blindly — verify browser-use health and that the target URL is reachable from the sidecar network. " +
          "Fall back to code-only review.",
        data: { url: targetUrl, retryable: false, openResult },
      };
    }

    // BI-1BAA177C: a degraded/errored navigation means nothing after this
    // point is evidence — report NOT-RUN instead of success-shaped emptiness.
    if (openContent.degraded === true || openContent.status === "error") {
      const reason = openContent.reason ?? openContent.error ?? "browser agent could not drive the browser";
      return {
        success: false,
        error: `Page evaluation DEGRADED — did not run: ${reason}`,
        message:
          `Page evaluation did not run: ${reason}. This is a NOT-RUN (browser-use could not drive its browser), not a clean page. ` +
          "Do NOT retry the same args. Check GET /health/capability on the sidecar and use a container-reachable URL.",
        data: { url: targetUrl, degraded: true, reason, retryable: false },
      };
    }

    // Extract accessibility and UX findings using AI analysis
    const evalRes = await fetch(BROWSER_USE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "browse_extract",
          arguments: {
            session_id: sessionId,
            query: "Analyze this page for UX and accessibility issues. Check for: missing alt text, low contrast text, missing form labels, heading hierarchy issues, keyboard navigation problems, focus indicators, semantic HTML usage. Return a JSON array of findings, each with: severity (critical/important/minor), category (contrast/accessibility/focus/semantic-html/responsive), element (CSS selector or description), issue (what's wrong), recommendation (how to fix), wcagRef (WCAG guideline reference if applicable).",
          },
        },
      }),
      signal: AbortSignal.timeout(120000),
    });
    const evalResult = await evalRes.json();
    const evalContent = JSON.parse(evalResult?.result?.content?.[0]?.text ?? "{}");
    if (evalContent.degraded === true) {
      const reason = evalContent.reason ?? "browser agent could not analyze the page";
      return {
        success: false,
        error: `Page evaluation DEGRADED — did not run: ${reason}`,
        message: `Page evaluation did not run: ${reason}. This is a NOT-RUN, not a zero-findings result.`,
        data: { url: targetUrl, degraded: true, reason },
      };
    }

    // Get screenshot
    const ssRes = await fetch(BROWSER_USE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "browse_screenshot",
          arguments: { session_id: sessionId },
        },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const ssResult = await ssRes.json();
    const ssContent = JSON.parse(ssResult?.result?.content?.[0]?.text ?? "{}");

    // Close session
    await fetch(BROWSER_USE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "browse_close", arguments: { session_id: sessionId } },
      }),
      signal: AbortSignal.timeout(10000),
    });

    // Parse findings — the AI extraction returns structured data.
    // An unreadable payload is a NOT-RUN, never an empty findings list: a failed
    // extraction otherwise reports as "0 UX/accessibility issues", i.e. a clean
    // page (BI-C3768478, extending the BI-1BAA177C contract above).
    const { interpretExtraction } = await import("@/lib/tak/page-evaluator");
    const outcome = interpretExtraction(evalContent.data);
    if (outcome.kind === "not-run") {
      return {
        success: false,
        error: `Page evaluation DEGRADED — did not run: ${outcome.reason}`,
        message: `Page evaluation did not run: ${outcome.reason}. This is a NOT-RUN, not a zero-findings result.`,
        data: { url: targetUrl, degraded: true, reason: outcome.reason },
      };
    }
    const findings = outcome.raw;

    // Visual cognitive-load assessment — feed the rendered screenshot to a
    // vision-capable model (capability-routed; local Gemma 4 when configured)
    // so the structural findings above are joined by a MEASURED visual signal
    // that flows into the WWMD human_cognitive_load rubric. Best-effort: a
    // null (no vision endpoint / parse miss) never fails the evaluation.
    let visualCognitiveLoad:
      | import("@/lib/decision/visual-cognitive-load").VisualCognitiveLoad
      | null = null;
    const screenshotB64 = ssContent.screenshot_base64 ?? null;
    if (screenshotB64) {
      try {
        const { assessVisualCognitiveLoad } = await import("@/lib/decision/visual-cognitive-load");
        visualCognitiveLoad = await assessVisualCognitiveLoad(screenshotB64);
      } catch {
        visualCognitiveLoad = null;
      }
    }

    return {
      success: true,
      message: `Found ${findings.length} UX/accessibility issues on ${targetUrl}.`
        + (visualCognitiveLoad
          ? ` Visual cognitive load: ${visualCognitiveLoad.cognitiveLoad.toFixed(2)}.`
          : ""),
      data: {
        url: targetUrl,
        screenshot: screenshotB64,
        findingCount: findings.length,
        findings,
        visualCognitiveLoad,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: getErrorMessage(e),
      message: "UX verification service (browser-use) is unreachable. Run 'docker compose up -d browser-use' or check the browser-use container logs. You can fall back to code-only analysis using read_project_file.",
    };
  }
}

async function searchDesignIntelligenceHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { searchDesignDomain, formatSearchResults } = await import("@/lib/design-intelligence");
  const query = String(params.query ?? "");
  const domain = String(params.domain ?? "style") as import("@/lib/design-intelligence").DesignDomain;
  const maxResults = Number(params.max_results ?? 5);
  if (!query) return { success: false, error: "Query is required.", message: "Provide search keywords." };
  const results = searchDesignDomain(query, domain, maxResults);
  const formatted = formatSearchResults(results, query, domain);
  return { success: true, message: formatted };
}

async function generateDesignSystemHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { generateDesignSystem } = await import("@/lib/design-intelligence");
  const query = String(params.query ?? "");
  const projectName = params.project_name ? String(params.project_name) : undefined;
  if (!query) return { success: false, error: "Query is required.", message: "Provide product description and keywords." };
  const designSystem = generateDesignSystem(query, projectName);
  return { success: true, message: designSystem };
}

async function analyzeBrandDocumentHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { fileName, fileType } = params as { fileName: string; fileContent: string; fileType: string };
  return {
    success: true,
    message: `Analyzing brand document: ${fileName} (${fileType})`,
    data: {
      companyName: null,
      logoDataUrl: null,
      colors: [],
      fonts: [],
      notes: `Document "${fileName}" received for brand analysis. The AI agent should analyze the base64 content to extract brand assets.`,
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  search_public_web: (params, userId, context) => searchPublicWebHandler(params, userId, context),
  fetch_public_website: (params, userId, context) => fetchPublicWebsiteHandler(params, userId, context),
  analyze_public_website_branding: (params, userId, context) => analyzePublicWebsiteBrandingHandler(params, userId, context),
  extract_brand_design_system: (params, userId, context) => extractBrandDesignSystemHandler(params, userId, context),
  evaluate_page: (params, userId, context) => evaluatePageHandler(params, userId, context),
  search_design_intelligence: (params) => searchDesignIntelligenceHandler(params),
  generate_design_system: (params) => generateDesignSystemHandler(params),
  analyze_brand_document: (params) => analyzeBrandDocumentHandler(params),
};

export const publicWebDesignPack: ToolPack = {
  packId: "public-web-design",
  definitions,
  handlers,
  grants: {
    search_public_web: ["web_search"],
    fetch_public_website: ["web_search"],
    analyze_public_website_branding: ["web_search"],
    extract_brand_design_system: ["web_search", "file_read", "admin_write"],
    evaluate_page: ["file_read"],
    search_design_intelligence: ["file_read"],
    generate_design_system: ["file_read"],
    analyze_brand_document: ["file_read"],
  },
};
