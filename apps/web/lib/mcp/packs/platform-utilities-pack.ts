// Platform utilities tool pack — BI-ARCH-TOOLPACKS.
//
// Drains a set of self-contained platform utility doors out of the mcp-tools.ts
// executeTool switch — each delegates to a domain module and shares nothing with
// the build-execution helpers the rest of the switch relies on:
//   - create_digital_product          register a product in the inventory
//   - setup_email                      operator SMTP detect/save/test
//   - drive_browser_task               governed authenticated-browser task
//   - list_patch_posture               estate patch-finding summary
//   - dpf_test_kernel_refuse_probe     test-only synthetic kernel-gate probe
//   - trigger_contributor_inventory_sync  dispatch an on-demand inventory sync
//   - get_finance_period_summary       verified income/expenses/net for a period
//
// Each handler reproduces the former switch case verbatim (dynamic imports
// retargeted to absolute @/lib paths), so behaviour is identical when a tool is
// invoked over MCP. None of these tools carry a TOOL_TO_GRANTS entry, so grants
// is empty and there is nothing to drift against.
//
// The refuse probe is dispatch-only (test hook) and was never advertised in the
// tool registry, so it registers a handler but no definition — keeping it out of
// PLATFORM_TOOLS exactly as before.

import { getErrorMessage } from "@/lib/shared/get-error-message";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "create_digital_product",
    description: "Register a new digital product in the inventory",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Product name" },
        productId: { type: "string", description: "Unique product identifier" },
        lifecycleStage: { type: "string", enum: ["plan", "design", "build", "production", "retirement"] },
        portfolioSlug: { type: "string", description: "Portfolio slug to assign to" },
      },
      required: ["name", "productId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "get_finance_period_summary",
    description: "Return verified income, expenses, and net for a finance period (defaults to month-to-date). Income = sum of paid invoices; expenses = sum of paid bills + paid expense claims; net = income - expenses. Includes pending receivables/payables, multi-currency flags, source paths, and explicit gap descriptions when activity is missing. Use this whenever the user asks for a P&L figure, income vs expenses, or net cash position for a period - it is the canonical numeric answer for the Finance Specialist coworker.",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["month-to-date", "last-month", "quarter-to-date", "year-to-date"],
          description: "Preset period. Defaults to month-to-date. Ignored when startDate/endDate are provided.",
        },
        startDate: {
          type: "string",
          description: "ISO date (e.g. 2026-05-01). When set, period is treated as a custom window. endDate is required alongside.",
        },
        endDate: {
          type: "string",
          description: "ISO date for the end of the custom window. Must be on or after startDate.",
        },
      },
      required: [],
    },
    requiredCapability: "view_finance",
    executionMode: "immediate",
    sideEffect: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "drive_browser_task",
    description:
      "Drive an authenticated browser to perform a bounded task on an auth-walled site (supplier portal, Substack, ad dashboard) that has no usable API. Picks the means by a governed decision, runs against a provisioned service-account profile (or the operator's attended session), and audits every action. Outward irreversible actions (publish/submit/send/order/configure) are NOT executed directly — they return awaiting-approval with an envelope the human approves first. Returns needs-provisioning when the site has no service-account profile yet (set one up in Service Account Browser Setup).",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Natural-language task for the browser, e.g. 'fill the newsletter draft title and body'." },
        siteKey: { type: "string", description: "Site identifier selecting the provisioned profile, e.g. 'substack'." },
        accountKey: { type: "string", description: "Account within the site. Defaults to 'default'." },
        targetDomains: { type: "array", items: { type: "string" }, description: "Navigation allowlist; the session may only drive these domains." },
        targetUrl: { type: "string", description: "Optional URL to open at." },
        kind: { type: "string", enum: ["read", "act"], description: "read = extract data only; act = drive (default)." },
        mode: { type: "string", enum: ["service-account", "operator-live"], description: "service-account (autonomous, default) or operator-live (attended)." },
        outwardAction: { type: "string", enum: ["publish", "submit", "send", "order", "configure"], description: "Set ONLY when the task takes an outward irreversible action — gates an approval envelope instead of acting." },
        renderedArtifact: { type: "object", description: "The exact payload the human approves at the destructive boundary (rendered post/form)." },
        rationale: { type: "string", description: "Why this action — recorded on the approval envelope." },
      },
      required: ["task", "siteKey", "targetDomains"],
    },
    requiredCapability: null,
    requiresExternalAccess: true,
    executionMode: "immediate",
    sideEffect: true,
    // reaches a third party → consult-gated (TAK §8.4.1).
    consequence: "outward",
  },
  {
    name: "setup_email",
    description:
      "Help the operator set up their OWN outbound email (SMTP) so the platform can send invoices, payment links, dunning, and approvals. Three actions: action='detect' identifies the provider from the organization's domain and returns the one credential the operator must obtain (e.g. a Google App Password); action='save' persists the SMTP settings the operator provides; action='test' sends a test email to confirm delivery. DPF never relays email on the operator's behalf — their own provider sends. Walk the operator through getting the credential in plain language before calling 'save'.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["detect", "save", "test"], description: "detect | save | test" },
        host: { type: "string", description: "SMTP host (save) — e.g. smtp.gmail.com" },
        port: { type: "number", description: "SMTP port (save) — default 587 (STARTTLS) or 465 (implicit TLS)" },
        secure: { type: "boolean", description: "Implicit TLS on port 465 (save)" },
        user: { type: "string", description: "SMTP username (save) — usually the full email address" },
        from: { type: "string", description: "From address (save) — e.g. 'Acme <billing@acme.com>'" },
        pass: { type: "string", description: "SMTP password / app password / API key (save). Leave blank to keep the existing one." },
        to: { type: "string", description: "Recipient for the test email (test)" },
      },
      required: ["action"],
    },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
    // reaches a third party → consult-gated (TAK §8.4.1).
    consequence: "outward",
  },
  {
    name: "list_patch_posture",
    description:
      "Summarize estate patch posture: open patch findings (vulnerabilities, available updates, end-of-life) across discovered software, ranked by severity and active exploitation (CISA KEV).",
    inputSchema: {
      type: "object",
      properties: {
        severity: { type: "string", description: "Filter to one severity: critical|high|medium|low|info (optional)" },
        status: { type: "string", description: "open (default) or all to include resolved (optional)" },
      },
      required: [],
    },
    requiredCapability: "view_inventory",
    sideEffect: false,
  },
  {
    name: "trigger_contributor_inventory_sync",
    description:
      "Dispatch an on-demand contributor inventory sync (git worktrees, branches, GitHub PRs) without waiting for the 10-minute cron. Used by agents that just made an external change (pushed a branch, opened a PR) and want the /platform/development/change-lanes dashboard to reflect it on the next refresh. Returns the Inngest event id immediately; the runner creates the ContributorInventorySyncRun row asynchronously.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Optional short tag propagated to the run row's triggeredBy field for audit.",
        },
      },
    },
    requiredCapability: "manage_provider_connections",
    executionMode: "immediate",
    sideEffect: true,
  },
];

async function createDigitalProduct(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const product = await prisma.digitalProduct.create({
    data: {
      productId: String(params["productId"]),
      name: String(params["name"]),
      lifecycleStage: String(params["lifecycleStage"] ?? "plan"),
      lifecycleStatus: "draft",
    },
  });
  return { success: true, entityId: product.productId, message: `Created product ${product.productId}` };
}

async function getFinancePeriodSummary(params: Record<string, unknown>): Promise<ToolResult> {
  const { formatFinancePeriodSummary, getFinancePeriodSummary } = await import("@/lib/finance/period-summary");
  const periodInput: Parameters<typeof getFinancePeriodSummary>[0] = {};
  const period = typeof params["period"] === "string" ? params["period"] : undefined;
  if (period === "month-to-date" || period === "last-month" || period === "quarter-to-date" || period === "year-to-date") {
    periodInput.period = period;
  }
  if (typeof params["startDate"] === "string" && params["startDate"].trim()) {
    periodInput.startDate = params["startDate"];
  }
  if (typeof params["endDate"] === "string" && params["endDate"].trim()) {
    periodInput.endDate = params["endDate"];
  }

  try {
    const summary = await getFinancePeriodSummary(periodInput);
    return {
      success: true,
      message: formatFinancePeriodSummary(summary),
      data: summary as unknown as Record<string, unknown>,
    };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { success: false, error: msg, message: `get_finance_period_summary failed: ${msg}` };
  }
}

async function driveBrowserTaskHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  // Dynamic import: drive → select-means → mcp-tools forms a static cycle;
  // importing here breaks it (same pattern as agent-grants / mcp-server-tools).
  const { driveBrowserTask } = await import("@/lib/browser-drive/drive");
  const { isDestructiveBrowserAction } = await import("@/lib/browser-drive/envelope");
  const outward = String(params["outwardAction"] ?? "");
  const result = await driveBrowserTask({
    task: String(params["task"] ?? ""),
    siteKey: String(params["siteKey"] ?? ""),
    accountKey: typeof params["accountKey"] === "string" ? (params["accountKey"] as string) : undefined,
    targetDomains: Array.isArray(params["targetDomains"]) ? (params["targetDomains"] as unknown[]).map(String) : [],
    targetUrl: typeof params["targetUrl"] === "string" ? (params["targetUrl"] as string) : undefined,
    kind: params["kind"] === "read" ? "read" : "act",
    mode: params["mode"] === "operator-live" ? "operator-live" : "service-account",
    outwardAction: isDestructiveBrowserAction(outward) ? outward : undefined,
    renderedArtifact: params["renderedArtifact"],
    rationale: typeof params["rationale"] === "string" ? (params["rationale"] as string) : undefined,
    agentId: context?.agentId?.trim() || "coworker",
    threadId: context?.threadId?.trim() || "",
    userId,
  });
  const messages: Record<string, string> = {
    completed: "Browser task completed.",
    "awaiting-approval": "Rendered the action for your approval — it will run once you approve the envelope.",
    "needs-provisioning": `No service-account profile for "${String(params["siteKey"] ?? "")}" yet. Set one up in Service Account Browser Setup.`,
    "needs-human": "The means selector wasn't confident — needs a human decision.",
    blocked: "Blocked.",
    error: "Browser task failed.",
  };
  return {
    success: result.status === "completed" || result.status === "awaiting-approval",
    message: messages[result.status] ?? result.status,
    data: result,
  };
}

async function setupEmail(params: Record<string, unknown>): Promise<ToolResult> {
  const { runEmailSetupTool } = await import("@/lib/shared/email-setup-tool");
  const result = await runEmailSetupTool({
    action: String(params.action ?? "") as "detect" | "save" | "test",
    host: typeof params.host === "string" ? params.host : undefined,
    port: typeof params.port === "number" ? params.port : undefined,
    secure: typeof params.secure === "boolean" ? params.secure : undefined,
    user: typeof params.user === "string" ? params.user : undefined,
    from: typeof params.from === "string" ? params.from : undefined,
    pass: typeof params.pass === "string" ? params.pass : undefined,
    to: typeof params.to === "string" ? params.to : undefined,
  });
  return {
    success: result.ok,
    message: result.message,
    ...(result.error ? { error: result.error } : {}),
    data: result.data,
  };
}

async function listPatchPosture(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const { getPatchPosture } = await import("@/lib/patch/patch-posture");
  const status = params["status"] === "all" ? "all" : "open";
  const posture = await getPatchPosture(
    prisma as unknown as Parameters<typeof getPatchPosture>[0],
    { status, limit: 200 },
  );
  const severity = typeof params["severity"] === "string" ? params["severity"] : undefined;
  const findings = severity
    ? posture.findings.filter((finding) => finding.policySeverity === severity)
    : posture.findings;
  const totals = posture.totals;
  return {
    success: true,
    message: `Estate patch posture: ${totals.findings} open finding(s) across ${totals.hosts} host(s) — ${totals.bySeverity.critical ?? 0} critical, ${totals.bySeverity.high ?? 0} high, ${totals.kev} actively exploited (KEV).`,
    data: {
      totals,
      capped: posture.capped,
      findings: findings.slice(0, 50),
    },
  };
}

async function dpfTestKernelRefuseProbe(): Promise<ToolResult> {
  // Test-only synthetic probe (Phase 9 live verification).
  // Reachable ONLY when DPF_TEST_MCP_REFUSE_PROBE=1 because:
  //   - loadEnforceablePrinciples injects a synthetic principle that
  //     matches this tool name with refuse-in-both-modes, so the gate
  //     above short-circuits before this body ever runs.
  //   - When the env is unset, no principle matches, but neither does
  //     any production code path call this tool name — we return the
  //     unknown-tool default below.
  // The body exists to give the dispatcher a recognizable case so the
  // gate gets a chance to refuse before falling through to unknown-tool.
  if (process.env.DPF_TEST_MCP_REFUSE_PROBE !== "1") {
    return { success: false, message: "tool not registered", error: "tool not registered" };
  }
  return {
    success: true,
    message: "probe tool body — should not be reached when gate is wired and DPF_TEST_MCP_REFUSE_PROBE=1",
  };
}

async function triggerContributorInventorySync(params: Record<string, unknown>): Promise<ToolResult> {
  // BI-063BDF1B Phase 5 — admin-scope handle for agents to dispatch the
  // on-demand Inngest event. The runner is contributorInventorySyncOnDemand
  // in apps/web/lib/queue/functions/contributor-inventory-sync.ts.
  const reason = typeof params["reason"] === "string" ? params["reason"] : null;
  try {
    const { inngest } = await import("@/lib/queue/inngest-client");
    const result = await inngest.send({
      name: "ops/contributor-inventory-sync.run",
      data: { triggeredBy: reason ? `mcp:${reason}` : "mcp" },
    });
    return {
      success: true,
      message: "Queued an on-demand contributor inventory sync.",
      data: { eventIds: result.ids, status: "queued" },
    };
  } catch (err) {
    const msg = getErrorMessage(err);
    return {
      success: false,
      error: msg,
      message: `trigger_contributor_inventory_sync failed: ${msg}`,
    };
  }
}

const handlers: Record<string, ToolPackHandler> = {
  create_digital_product: (params) => createDigitalProduct(params),
  get_finance_period_summary: (params) => getFinancePeriodSummary(params),
  drive_browser_task: (params, userId, context) => driveBrowserTaskHandler(params, userId, context),
  setup_email: (params) => setupEmail(params),
  list_patch_posture: (params) => listPatchPosture(params),
  dpf_test_kernel_refuse_probe: () => dpfTestKernelRefuseProbe(),
  trigger_contributor_inventory_sync: (params) => triggerContributorInventorySync(params),
};

export const platformUtilitiesPack: ToolPack = {
  packId: "platform-utilities",
  definitions,
  handlers,
  grants: {},
};
