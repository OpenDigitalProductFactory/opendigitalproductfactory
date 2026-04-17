/**
 * GET /api/diagnostics/preflight
 *
 * End-to-end chain verification for Build Studio.
 * Tests every step from provider configuration through routing, tools,
 * skills, and sandbox — reports exactly where the chain breaks.
 *
 * Requires admin auth. Returns structured diagnostic report.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

export const dynamic = "force-dynamic";

type StepResult = {
  step: string;
  status: "pass" | "fail" | "warn" | "skip";
  message: string;
  detail?: Record<string, unknown>;
  durationMs: number;
};

async function runStep(
  step: string,
  fn: () => Promise<{ status: "pass" | "fail" | "warn" | "skip"; message: string; detail?: Record<string, unknown> }>,
): Promise<StepResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return { step, ...result, durationMs: Date.now() - start };
  } catch (err) {
    return {
      step,
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check superuser
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperuser: true },
  });
  if (!user?.isSuperuser) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const steps: StepResult[] = [];

  // ─── Step 1: Provider Configuration ──────────────────────────────────────
  const providerStep = await runStep("1. Provider Configuration", async () => {
    const providers = await prisma.modelProvider.findMany({
      where: { status: { in: ["active", "degraded"] } },
      select: { providerId: true, name: true, status: true, endpointType: true },
    });

    const llmProviders = providers.filter(p => p.endpointType === "llm");
    if (llmProviders.length === 0) {
      return {
        status: "fail",
        message: "No active LLM providers configured. Go to Admin > AI Workforce to connect a provider.",
        detail: { totalProviders: providers.length, llmProviders: 0 },
      };
    }

    return {
      status: "pass",
      message: `${llmProviders.length} active LLM provider(s): ${llmProviders.map(p => p.name ?? p.providerId).join(", ")}`,
      detail: {
        providers: llmProviders.map(p => ({
          id: p.providerId,
          name: p.name,
          status: p.status,
        })),
      },
    };
  });
  steps.push(providerStep);

  // ─── Step 2: Credentials ─────────────────────────────────────────────────
  steps.push(await runStep("2. Provider Credentials", async () => {
    // Get active LLM provider IDs, then check their credentials
    const activeProviders = await prisma.modelProvider.findMany({
      where: { status: { in: ["active", "degraded"] }, endpointType: "llm" },
      select: { providerId: true },
    });
    const activeIds = activeProviders.map(p => p.providerId);

    const credentials = await prisma.credentialEntry.findMany({
      where: { providerId: { in: activeIds } },
      select: { providerId: true, status: true },
    });

    const valid = credentials.filter(c => c.status === "ok" || c.status === "configured");
    const invalid = credentials.filter(c => c.status !== "ok" && c.status !== "configured");
    const keyRotated = credentials.filter(c => c.status === "key_rotated");

    // Key rotation is a distinct failure mode — surface it with a clear fix.
    // Startup credential-health-check flagged these as undecryptable with the
    // current CREDENTIAL_ENCRYPTION_KEY.  See PROVIDER-ACTIVATION-AUDIT.md F-15/F-16.
    if (keyRotated.length > 0) {
      return {
        status: "fail",
        message: `${keyRotated.length} provider(s) need re-authentication — encryption key changed since credentials were stored: ${keyRotated.map(c => c.providerId).join(", ")}. Go to Admin > AI Workforce > External Services and re-enter the API key or re-authorize OAuth.`,
        detail: {
          keyRotated: keyRotated.map(c => c.providerId),
          valid: valid.map(c => c.providerId),
          invalid: invalid.filter(c => c.status !== "key_rotated").map(c => ({ id: c.providerId, status: c.status })),
          fix: "Re-enter API key or re-authorize OAuth for each provider with status=key_rotated",
        },
      };
    }

    if (valid.length === 0) {
      return {
        status: "fail",
        message: "No valid credentials found for any LLM provider. Go to Admin > AI Workforce > External Services.",
        detail: { total: credentials.length, valid: 0, invalid: invalid.length },
      };
    }

    const result: { status: "pass" | "warn"; message: string; detail: Record<string, unknown> } = {
      status: valid.length > 0 && invalid.length > 0 ? "warn" : "pass",
      message: `${valid.length} provider(s) with valid credentials: ${valid.map(c => c.providerId).join(", ")}`,
      detail: {
        valid: valid.map(c => c.providerId),
        invalid: invalid.map(c => ({ id: c.providerId, status: c.status })),
      },
    };
    if (invalid.length > 0) {
      result.message += `. ${invalid.length} provider(s) with issues: ${invalid.map(c => `${c.providerId} (${c.status})`).join(", ")}`;
    }
    return result;
  }));

  // ─── Step 3: Model Availability ──────────────────────────────────────────
  steps.push(await runStep("3. Model Availability", async () => {
    const profiles = await prisma.modelProfile.findMany({
      where: {
        modelStatus: { in: ["active", "degraded"] },
        retiredAt: null,
        provider: { status: { in: ["active", "degraded"] }, endpointType: "llm" },
      },
      select: { providerId: true, modelId: true, modelFamily: true, modelClass: true },
    });

    if (profiles.length === 0) {
      return {
        status: "fail",
        message: "No active models found. Run model discovery from Admin > AI Workforce.",
        detail: { modelCount: 0 },
      };
    }

    // Check for tool-capable models
    const toolCapable = profiles.filter(p =>
      p.modelFamily && !["o1-mini", "o1-preview"].includes(p.modelFamily),
    );

    const byProvider = profiles.reduce<Record<string, number>>((acc, p) => {
      acc[p.providerId] = (acc[p.providerId] ?? 0) + 1;
      return acc;
    }, {});

    return {
      status: toolCapable.length > 0 ? "pass" : "warn",
      message: `${profiles.length} active model(s) across ${Object.keys(byProvider).length} provider(s)`,
      detail: {
        totalModels: profiles.length,
        byProvider,
        toolCapableCount: toolCapable.length,
      },
    };
  }));

  // ─── Step 4: Routing Probe ───────────────────────────────────────────────
  steps.push(await runStep("4. Routing (basic chat)", async () => {
    const { loadEndpointManifests, loadPolicyRules, loadOverrides } = await import("@/lib/routing/loader");
    const { inferContract } = await import("@/lib/routing/request-contract");
    const { routeEndpointV2 } = await import("@/lib/routing/pipeline-v2");

    const manifests = await loadEndpointManifests();
    if (manifests.length === 0) {
      return { status: "fail", message: "No endpoint manifests loaded — routing has nothing to select from." };
    }

    const policies = await loadPolicyRules();
    const overrides = await loadOverrides("chat");
    const contract = await inferContract("chat", [{ role: "user", content: "Hello" }]);
    const decision = await routeEndpointV2(manifests, contract, policies, overrides);

    if (!decision.selectedEndpoint) {
      return {
        status: "fail",
        message: `Routing found no eligible endpoint for basic chat. Reason: ${decision.reason}`,
        detail: {
          candidateCount: decision.candidates.length,
          excludedCount: decision.candidates.filter(c => c.excluded).length,
          exclusionReasons: decision.candidates
            .filter(c => c.excluded)
            .slice(0, 5)
            .map(c => `${c.endpointId}: ${c.excludedReason}`),
        },
      };
    }

    return {
      status: "pass",
      message: `Routed to ${decision.selectedEndpoint} (${decision.selectedModelId})`,
      detail: {
        provider: decision.selectedEndpoint,
        model: decision.selectedModelId,
        candidateCount: decision.candidates.filter(c => !c.excluded).length,
        fallbackCount: decision.fallbackChain.length,
      },
    };
  }));

  // ─── Step 5: Routing Probe (with tools) ──────────────────────────────────
  steps.push(await runStep("5. Routing (with tools)", async () => {
    const { loadEndpointManifests, loadPolicyRules, loadOverrides } = await import("@/lib/routing/loader");
    const { inferContract } = await import("@/lib/routing/request-contract");
    const { routeEndpointV2 } = await import("@/lib/routing/pipeline-v2");

    const manifests = await loadEndpointManifests();
    const policies = await loadPolicyRules();
    const overrides = await loadOverrides("chat");

    // Simulate a tool-using request (like Build Studio's agentic loop)
    const sampleTool = [{
      type: "function",
      function: { name: "read_sandbox_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
    }];
    const contract = await inferContract("agentic", [{ role: "user", content: "Read the schema" }], sampleTool);
    const decision = await routeEndpointV2(manifests, contract, policies, overrides);

    if (!decision.selectedEndpoint) {
      const excluded = decision.candidates.filter(c => c.excluded);
      return {
        status: "fail",
        message: `No endpoint supports tool use. Build Studio requires tool-capable models.`,
        detail: {
          candidateCount: decision.candidates.length,
          excludedReasons: excluded.slice(0, 5).map(c => `${c.endpointId}: ${c.excludedReason}`),
        },
      };
    }

    return {
      status: "pass",
      message: `Tool-capable route: ${decision.selectedEndpoint} (${decision.selectedModelId})`,
      detail: {
        provider: decision.selectedEndpoint,
        model: decision.selectedModelId,
      },
    };
  }));

  // ─── Step 6: Tool Availability ───────────────────────────────────────────
  steps.push(await runStep("6. Platform Tools", async () => {
    const { getAvailableTools } = await import("@/lib/mcp-tools");
    const userContext = {
      userId: session.user!.id,
      platformRole: "HR-400",
      isSuperuser: true,
    };
    const tools = await getAvailableTools(userContext, { mode: "act" });

    // Check for Build Studio critical tools
    const buildTools = ["read_sandbox_file", "write_sandbox_file", "search_sandbox",
      "list_sandbox_files", "run_sandbox_command", "describe_model",
      "validate_schema", "saveBuildEvidence"];
    const available = buildTools.filter(t => tools.some(tool => tool.name === t));
    const missing = buildTools.filter(t => !tools.some(tool => tool.name === t));

    if (missing.length > 0) {
      return {
        status: missing.length > 3 ? "fail" : "warn",
        message: `${available.length}/${buildTools.length} Build Studio tools available. Missing: ${missing.join(", ")}`,
        detail: { totalTools: tools.length, buildToolsAvailable: available, buildToolsMissing: missing },
      };
    }

    return {
      status: "pass",
      message: `All ${buildTools.length} Build Studio tools available (${tools.length} total platform tools)`,
      detail: { totalTools: tools.length },
    };
  }));

  // ─── Step 7: Build Studio Config ─────────────────────────────────────────
  steps.push(await runStep("7. Build Studio Config", async () => {
    const { getBuildStudioConfig } = await import("@/lib/integrate/build-studio-config");
    const config = await getBuildStudioConfig();

    const providerLabel = config.provider === "claude" ? "Claude CLI"
      : config.provider === "codex" ? "Codex CLI"
      : "Agentic (built-in)";

    if (config.provider === "agentic") {
      return {
        status: "pass",
        message: `Dispatch: ${providerLabel}. Uses internal routing — no external CLI needed.`,
        detail: { config },
      };
    }

    // Verify the selected CLI provider has credentials
    const providerId = config.provider === "claude" ? config.claudeProviderId : config.codexProviderId;
    if (!providerId) {
      return {
        status: "fail",
        message: `Dispatch set to ${providerLabel} but no provider ID configured.`,
        detail: { config },
      };
    }

    const { getDecryptedCredential } = await import("@/lib/inference/ai-provider-internals");
    const cred = await getDecryptedCredential(providerId);
    const hasAuth = config.provider === "claude"
      ? !!(cred?.cachedToken || cred?.secretRef)
      : !!cred?.cachedToken;

    if (!hasAuth) {
      return {
        status: "fail",
        message: `Dispatch set to ${providerLabel} (${providerId}) but credentials are missing. Go to Admin > AI Workforce.`,
        detail: { config, providerId, hasCredential: false },
      };
    }

    return {
      status: "pass",
      message: `Dispatch: ${providerLabel} via ${providerId}`,
      detail: { config, providerId, hasCredential: true },
    };
  }));

  // ─── Step 8: Specialist Agents ───────────────────────────────────────────
  steps.push(await runStep("8. Specialist Agents", async () => {
    const requiredAgents = ["AGT-BUILD-DA", "AGT-BUILD-SE", "AGT-BUILD-FE", "AGT-BUILD-QA", "AGT-ORCH-300"];
    const agents = await prisma.agent.findMany({
      where: { agentId: { in: requiredAgents } },
      select: { agentId: true, name: true, tier: true },
    });

    const found = agents.map(a => a.agentId);
    const missing = requiredAgents.filter(id => !found.includes(id));

    if (missing.length > 0) {
      return {
        status: "fail",
        message: `Missing specialist agents: ${missing.join(", ")}. Run seed to register them.`,
        detail: { found, missing },
      };
    }

    return {
      status: "pass",
      message: `All ${requiredAgents.length} specialist agents registered`,
      detail: { agents: agents.map(a => ({ id: a.agentId, name: a.name, tier: a.tier })) },
    };
  }));

  // ─── Step 9: Sandbox Pool ────────────────────────────────────────────────
  steps.push(await runStep("9. Sandbox Availability", async () => {
    // Check if sandbox container is accessible
    const sandboxContainer = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

    // Check sandbox pool if it exists
    try {
      const slots = await prisma.sandboxSlot.findMany({
        select: { id: true, status: true },
      });
      const available = slots.filter(s => s.status === "available");
      const inUse = slots.filter(s => s.status === "in_use");

      if (slots.length === 0) {
        return {
          status: "warn",
          message: `No sandbox pool configured. Builds use direct container: ${sandboxContainer}`,
          detail: { mode: "direct", container: sandboxContainer },
        };
      }

      return {
        status: available.length > 0 ? "pass" : "warn",
        message: `Sandbox pool: ${available.length} available, ${inUse.length} in use (${slots.length} total)`,
        detail: { available: available.length, inUse: inUse.length, total: slots.length },
      };
    } catch {
      // SandboxSlot table may not exist — direct mode
      return {
        status: "warn",
        message: `Sandbox pool table not available. Builds use direct container: ${sandboxContainer}`,
        detail: { mode: "direct", container: sandboxContainer },
      };
    }
  }));

  // ─── Step 10: Embedding Model ─────────────────────────────────────────────
  steps.push(await runStep("10. Embedding Model", async () => {
    const { isEmbeddingAvailable, generateEmbedding } = await import("@/lib/inference/embedding");

    const available = await isEmbeddingAvailable();
    if (!available) {
      return {
        status: "fail",
        message: "Embedding model not found. Run: docker model pull ai/nomic-embed-text-v1.5",
        detail: {
          modelAvailable: false,
          fix: "docker model pull ai/nomic-embed-text-v1.5",
          note: "This model is auto-pulled on fresh install, but Docker Model Runner must be enabled in Docker Desktop settings.",
        },
      };
    }

    // Functional test: generate a real embedding
    const testVector = await generateEmbedding("diagnostic test embedding");
    if (!testVector) {
      return {
        status: "fail",
        message: "Embedding model listed but failed to generate vector. Check model-runner logs.",
        detail: { modelAvailable: true, generationWorking: false },
      };
    }

    return {
      status: "pass",
      message: `Embedding model operational (${testVector.length}-dim vectors)`,
      detail: { modelAvailable: true, generationWorking: true, dimensions: testVector.length },
    };
  }));

  // ─── Step 11: Vector Memory (Qdrant) ────────────────────────────────────────
  steps.push(await runStep("11. Vector Memory (Qdrant)", async () => {
    const { isQdrantHealthy, QDRANT_COLLECTIONS } = await import("@dpf/db");

    const qdrantConfiguredUrl = process.env.QDRANT_INTERNAL_URL ?? process.env.QDRANT_URL ?? "http://localhost:6333";
    const healthy = await isQdrantHealthy();
    if (!healthy) {
      return {
        status: "fail",
        message: `Qdrant is unreachable at ${qdrantConfiguredUrl}. Run: docker compose ps qdrant — restart if stopped.`,
        detail: {
          reachable: false,
          url: qdrantConfiguredUrl,
          fix: "docker compose restart qdrant",
          note: "Qdrant is included in the default compose stack. If the container keeps crashing, check logs with: docker compose logs qdrant",
        },
      };
    }

    // Check collection existence and point counts
    const qdrantUrl = process.env.QDRANT_INTERNAL_URL ?? process.env.QDRANT_URL ?? "http://localhost:6333";
    const collectionStats: Record<string, { exists: boolean; points: number }> = {};

    for (const name of [QDRANT_COLLECTIONS.AGENT_MEMORY, QDRANT_COLLECTIONS.PLATFORM_KNOWLEDGE]) {
      try {
        const res = await fetch(`${qdrantUrl}/collections/${name}`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json() as { result?: { points_count?: number } };
          collectionStats[name] = { exists: true, points: data.result?.points_count ?? 0 };
        } else {
          collectionStats[name] = { exists: false, points: 0 };
        }
      } catch {
        collectionStats[name] = { exists: false, points: 0 };
      }
    }

    const allExist = Object.values(collectionStats).every(c => c.exists);
    const totalPoints = Object.values(collectionStats).reduce((sum, c) => sum + c.points, 0);

    if (!allExist) {
      return {
        status: "warn",
        message: `Qdrant reachable but collections not yet created (created on first memory write).`,
        detail: { reachable: true, collections: collectionStats },
      };
    }

    return {
      status: totalPoints > 0 ? "pass" : "warn",
      message: `Qdrant operational — ${totalPoints} vectors across ${Object.keys(collectionStats).length} collections`,
      detail: { reachable: true, collections: collectionStats },
    };
  }));

  // ─── Summary ─────────────────────────────────────────────────────────────
  const passed = steps.filter(s => s.status === "pass").length;
  const failed = steps.filter(s => s.status === "fail").length;
  const warnings = steps.filter(s => s.status === "warn").length;
  const totalMs = steps.reduce((sum, s) => sum + s.durationMs, 0);

  const overallStatus = failed > 0 ? "fail" : warnings > 0 ? "warn" : "pass";

  return NextResponse.json({
    status: overallStatus,
    summary: `${passed} pass, ${failed} fail, ${warnings} warn — ${totalMs}ms`,
    steps,
    timestamp: new Date().toISOString(),
  });
}
