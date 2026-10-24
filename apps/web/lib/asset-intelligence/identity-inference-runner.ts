// AI identity-resolution fallback runner (EP-ASSET-INTELLIGENCE, spec §4.2/§8).
//
// Wires the pure @dpf/db engine to (a) the real prisma client and (b) a cheap-model
// inference fn built on routeAndCall(budgetClass="minimize_cost") — dynamic model
// discovery, NO vendor pinning. Maintains the ScheduledJob bookkeeping row and honors
// the per-job enabled kill switch, like the other governed sweeps.
//
// The cost guardrail lives in the engine: the model calls are batched and the runner
// passes a per-run token budget + hard call cap so a 10k+-entity estate cannot blow
// the AI budget in one pass.

import type {
  IdentityInferenceDiagnostic,
  IdentityInferenceResult,
  ProposedIdentity,
  UnresolvedEntityRow,
} from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { isJobEnabled } from "@/lib/operate/scheduled-jobs/core";
import {
  IDENTITY_INFERENCE_JOB_ID,
  IDENTITY_INFERENCE_JOB_NAME,
  IDENTITY_INFERENCE_SCAN_LIMIT,
  IDENTITY_INFERENCE_BATCH_SIZE,
  IDENTITY_INFERENCE_TOKEN_BUDGET,
  IDENTITY_INFERENCE_MAX_CALLS,
} from "./identity-inference-constants";

export type IdentityInferenceRunOutcome =
  | ({ skipped: false; diagnostic?: IdentityInferenceDiagnostic } & IdentityInferenceResult)
  | { skipped: true; reason: string };

const SYSTEM_PROMPT =
  "You are a software/hardware asset-identification assistant. Given discovery signals " +
  "for unidentified inventory items, return the canonical vendor + product for each item " +
  "you can confidently identify. Use official manufacturer and product names (e.g. " +
  '"PostgreSQL Global Development Group" / "PostgreSQL"). Reply with ONLY a JSON array; ' +
  "omit any item you cannot confidently identify. Each element: " +
  '{"entityId": string, "manufacturer": string, "product": string, "productVersion": string|null, ' +
  '"edition": string|null, "part": "a"|"o"|"h", "confidence": number between 0 and 1}. ' +
  "part = a for application/software, o for operating system, h for hardware. " +
  "Do not invent an identity you are unsure of — a lower confidence is correct for a guess.";

function buildBatchPrompt(batch: UnresolvedEntityRow[]): string {
  const items = batch.map((e) => ({
    entityId: e.id,
    name: e.name,
    entityType: e.entityType,
    manufacturer: e.manufacturer,
    productModel: e.productModel,
    observedVersion: e.observedVersion ?? e.normalizedVersion,
    // A compact slice of raw properties as extra signal, capped so one noisy row
    // cannot balloon the prompt (context/token economy).
    signals: truncateSignals(e.properties),
  }));
  return `Identify these ${batch.length} inventory items:\n${JSON.stringify(items)}`;
}

function truncateSignals(properties: unknown): unknown {
  if (!properties || typeof properties !== "object") return {};
  const entries = Object.entries(properties as Record<string, unknown>).slice(0, 12);
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    out[k] = typeof v === "string" ? v.slice(0, 120) : v;
  }
  return out;
}

/** Strip markdown fences and parse the model's JSON array of proposals. Never throws. */
export function parseProposals(content: string, batchIds: Set<string>): ProposedIdentity[] {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // Tolerate leading prose before the array.
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ProposedIdentity[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const entityId = typeof r.entityId === "string" ? r.entityId : null;
    const manufacturer = typeof r.manufacturer === "string" ? r.manufacturer : "";
    const product = typeof r.product === "string" ? r.product : "";
    if (!entityId || !batchIds.has(entityId) || !manufacturer || !product) continue;
    const confidence =
      typeof r.confidence === "number" && Number.isFinite(r.confidence)
        ? Math.max(0, Math.min(1, r.confidence))
        : 0;
    const part = r.part === "o" || r.part === "h" ? r.part : "a";
    out.push({
      entityId,
      manufacturer,
      product,
      productVersion: typeof r.productVersion === "string" ? r.productVersion : null,
      edition: typeof r.edition === "string" ? r.edition : null,
      part,
      confidence,
    });
  }
  return out;
}

/**
 * Run one bounded AI identity-resolution pass and record it against the ScheduledJob
 * row. Never throws — inference/DB errors are reflected in the row's lastStatus and a
 * failure count in the result.
 */
/**
 * Optional operator override for the AI auto-apply confidence gate. Parsed from
 * IDENTITY_INFERENCE_AUTO_APPLY_THRESHOLD (0..1); invalid/unset falls back to the
 * engine default. The default itself is already tuned for cheap/local models — this
 * exists so a high-precision-model install can RAISE the bar, not so operators must
 * tune it to get a working baseline.
 */
function resolveAutoApplyThresholdOverride(): number | undefined {
  const raw = process.env.IDENTITY_INFERENCE_AUTO_APPLY_THRESHOLD;
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return undefined;
  return parsed;
}

export async function runIdentityInferenceFallbackJob(
  options: { scanLimit?: number } = {},
): Promise<IdentityInferenceRunOutcome> {
  const { prisma, runIdentityInferenceFallback, diagnoseIdentityInference } = await import("@dpf/db");
  const { computeNextRunAt } = await import("@/lib/ai-provider-types");
  const autoApplyThreshold = resolveAutoApplyThresholdOverride();

  const job = await prisma.scheduledJob.upsert({
    where: { jobId: IDENTITY_INFERENCE_JOB_ID },
    create: {
      jobId: IDENTITY_INFERENCE_JOB_ID,
      name: IDENTITY_INFERENCE_JOB_NAME,
      schedule: "weekly",
      category: "editable",
      nextRunAt: computeNextRunAt("weekly", new Date()),
    },
    update: {},
    select: { schedule: true },
  });

  // Operator kill switch — the one shared implementation (BI-7E49FA15). Kept
  // here as well as in gateAtEntry because the run-now event path reaches this
  // runner without passing through the cron entry gate.
  if (!(await isJobEnabled(IDENTITY_INFERENCE_JOB_ID))) {
    return { skipped: true, reason: "disabled" };
  }

  await prisma.scheduledJob
    .update({
      where: { jobId: IDENTITY_INFERENCE_JOB_ID },
      data: { lastRunAt: new Date(), lastStatus: "running" },
    })
    .catch(() => {});

  // The injectable cheap-model inference fn. Contracted not to throw — a failed batch
  // resolves nothing (empty proposals) but still reports its token spend so the engine
  // budget still decrements and the loop makes forward progress.
  const infer = async (batch: UnresolvedEntityRow[]) => {
    const batchIds = new Set(batch.map((e) => e.id));
    try {
      const { routeAndCall } = await import("@/lib/inference/routed-inference");
      const routed = await routeAndCall(
        [{ role: "user", content: buildBatchPrompt(batch) }],
        SYSTEM_PROMPT,
        "internal",
        { taskType: "utility_identity_resolution", budgetClass: "minimize_cost", persistDecision: false },
      );
      return {
        proposals: parseProposals(routed.content, batchIds),
        tokensUsed: (routed.inputTokens ?? 0) + (routed.outputTokens ?? 0),
      };
    } catch {
      // Estimate a token cost for a failed call so a persistently-failing provider
      // still exhausts the budget instead of looping the whole scan.
      return { proposals: [] as ProposedIdentity[], tokensUsed: 1000 };
    }
  };

  try {
    const result = await runIdentityInferenceFallback(
      // The @dpf/db engine types its prisma surface as a minimal hand-rolled client
      // shape (method-shorthand, so bivariant); the real client satisfies it structurally.
      prisma as unknown as Parameters<typeof runIdentityInferenceFallback>[0],
      infer,
      {
        scanLimit: options.scanLimit ?? IDENTITY_INFERENCE_SCAN_LIMIT,
        batchSize: IDENTITY_INFERENCE_BATCH_SIZE,
        maxInferenceTokens: IDENTITY_INFERENCE_TOKEN_BUDGET,
        maxInferenceCalls: IDENTITY_INFERENCE_MAX_CALLS,
        ...(autoApplyThreshold !== undefined ? { autoApplyThreshold } : {}),
      },
    );

    // Proactive self-diagnosis: if the run resolved devices but applied almost
    // none, the confidence gate is starving identifications — surface it instead
    // of silently discarding correct results (operator feedback: no user would
    // ever know to look for this).
    const effectiveThreshold = autoApplyThreshold ?? 0.9;
    const diagnostic = diagnoseIdentityInference(result, effectiveThreshold);
    if (diagnostic) {
      console.warn(`[identity-inference] ${diagnostic.message}`);
    }

    const now = new Date();
    await prisma.scheduledJob
      .update({
        where: { jobId: IDENTITY_INFERENCE_JOB_ID },
        data: {
          lastRunAt: now,
          lastStatus: result.failures > 0 ? "partial" : "ok",
          lastError: result.failures > 0
            ? `${result.failures} failure(s)`
            : diagnostic
              ? `advisory: ${diagnostic.message}`
              : null,
          nextRunAt: computeNextRunAt(job.schedule, now),
        },
      })
      .catch(() => {});

    return { skipped: false, ...result, ...(diagnostic ? { diagnostic } : {}) };
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    await prisma.scheduledJob
      .update({
        where: { jobId: IDENTITY_INFERENCE_JOB_ID },
        data: { lastRunAt: new Date(), lastStatus: "error", lastError: message },
      })
      .catch(() => {});
    return { skipped: true, reason: `error: ${message}` };
  }
}
