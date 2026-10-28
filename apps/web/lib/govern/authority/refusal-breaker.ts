// apps/web/lib/govern/authority/refusal-breaker.ts
//
// BI-E458A9CB / BI-E4FEF984: a refusal is answered once, not forever.
//
// Every executor reaches a tool through governedExecuteTool: the native
// agentic loop, the scheduled re-drivers, Claude, Codex and Grok over
// /api/mcp/v1. A refusal used to be re-evaluated on every identical retry, and
// nothing told the caller what would change the answer. Measured on the dev
// install: one coworker drew `authority_denied` 4,761 times in one thread over
// 66 hours, then 575 approval re-polls; a reviewer drew ARTIFACT_AUTHOR_REQUIRED
// up to 40 times in a single run; Claude re-submitted merge_backlog_items 14
// times in a row and Codex 50-65 times per thread on lease and claim refusals.
//
// Two things fix that, here and nowhere else:
//
//   1. Every refusal carries a machine-readable `nextAction` in its `data`: the
//      exact next call with its args, or `retry: "never"` plus what will wake
//      the caller. Code reads this; the prose stays for the model.
//   2. An identical call (same principal, tool, args fingerprint and authority
//      facts) that was refused inside its window is PARKED: the recorded
//      envelope is returned again with no re-evaluation, no new authority row
//      and no new approval card. The first parked call records one
//      ImprovementSignal, so a refusal that keeps recurring files one item.
//
// How long a refusal parks follows its disposition (governed-rejection-
// disposition.ts, refusal-codes.ts), the one classification of what kind of
// answer a code is:
//
//   refused          a settled no. Parks for REFUSED_WINDOW_MS. The authority
//                    facts are part of the key, so a grant or room change is a
//                    different call and is evaluated at once.
//   awaiting-person  parks while its approval request is still pending; a
//                    decided or expired request releases it, so the approved
//                    call runs.
//   awaiting-input   the caller can supply the input. Parks for
//                    AWAITING_INPUT_WINDOW_MS, and the same principal's next
//                    successful write releases it, since that write may be
//                    the input.
//   inconclusive     the check could not run. One immediate retry is free;
//                    identical repeats then back off: 30 s, doubling, capped
//                    at 10 minutes.
//
// The park lives in process memory. A restart costs at most one extra
// evaluation per key, which is the old behaviour once, not a storm.

import { createHash } from "crypto";

import type { GovernedExecuteArgs, GovernedExecuteResult } from "@/lib/mcp-governed-execute-types";
import { canonicalWorkroomToolName } from "@/lib/tak/workroom-tool-aliases";
import type { OutcomeDisposition } from "@/lib/shared/outcome-disposition";
import { governedRefusalDisposition } from "@/lib/operate/mcp-call-efficiency/refusal-codes";
import { isRecord } from "@/lib/shared/coerce";

export const REFUSED_WINDOW_MS = 30 * 60_000;
export const AWAITING_INPUT_WINDOW_MS = 10 * 60_000;
const INCONCLUSIVE_BASE_MS = 30_000;
const INCONCLUSIVE_CAP_MS = 10 * 60_000;
const MAX_ENTRIES = 5_000;

/** What the caller does next. `retry: "never"` means calling again unchanged cannot change the answer. */
export type RefusalNextAction = {
  retry: "never" | "after-input" | "after";
  /** Present with `retry: "after"`: how long to back off before the same call. */
  retryAfterMs?: number;
  /** The exact next call, when there is one. */
  call?: { tool: string; args: Record<string, unknown> };
  /** What will change the answer, and who acts. */
  wakeBy?: {
    kind: "approval-decision" | "authority-change" | "input-change" | "person-decision";
    principal?: string;
    envelopeId?: string;
  };
  reason: string;
};

type ParkableDisposition = Extract<OutcomeDisposition, "refused" | "awaiting-person" | "awaiting-input" | "inconclusive">;
const PARKABLE: ReadonlySet<OutcomeDisposition> = new Set<OutcomeDisposition>(["refused", "awaiting-person", "awaiting-input", "inconclusive"]);

// Argument validation failures: not governed refusals, but the same arguments
// fail the same way every time, so an identical repeat is parked like a settled no.
const ARGUMENT_ERROR_CODES: ReadonlySet<string> = new Set(["invalid_input", "missing_required", "invalid_json", "invalid_cursor"]);

function dispositionOf(result: GovernedExecuteResult): ParkableDisposition | null {
  if (result.success) return null;
  if (typeof result.error === "string" && ARGUMENT_ERROR_CODES.has(result.error)) return "refused";
  const disposition = result.disposition ?? governedRefusalDisposition(result);
  return disposition && PARKABLE.has(disposition) ? disposition as ParkableDisposition : null;
}

function envelopeIdOf(result: GovernedExecuteResult): string | null {
  const id = result.data?.["envelopeId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

function approverOf(result: GovernedExecuteResult): string | undefined {
  const binding = result.data?.["approvalBinding"];
  const approver = isRecord(binding) ? binding["actingHumanUserId"] : undefined;
  return typeof approver === "string" ? approver : undefined;
}

function inconclusiveBackoffMs(repeat: number): number {
  return Math.min(INCONCLUSIVE_CAP_MS, INCONCLUSIVE_BASE_MS * 2 ** Math.max(0, repeat - 1));
}

/** The machine-readable next step for a refusal, or null when the result is not one. */
export function refusalNextAction(toolName: string, result: GovernedExecuteResult, repeat = 1): RefusalNextAction | null {
  const disposition = dispositionOf(result);
  if (!disposition) return null;
  const code = result.error ?? "refused";
  if (disposition === "awaiting-person") {
    const envelopeId = envelopeIdOf(result);
    const principal = approverOf(result);
    return {
      retry: "never",
      ...(envelopeId ? { call: { tool: "get_my_approval_status", args: { envelopeId } } } : {}),
      wakeBy: {
        kind: envelopeId ? "approval-decision" : "person-decision",
        ...(principal ? { principal } : {}),
        ...(envelopeId ? { envelopeId } : {}),
      },
      reason: `${toolName} waits on a person (${code}). Calling it again returns this same request; read its status instead.`,
    };
  }
  if (disposition === "inconclusive") {
    return {
      retry: "after",
      retryAfterMs: inconclusiveBackoffMs(repeat),
      reason: `${toolName} could not be checked (${code}). Retry the same call after the back-off.`,
    };
  }
  if (disposition === "awaiting-input") {
    return {
      retry: "after-input",
      wakeBy: { kind: "input-change" },
      reason: `${toolName} is missing an input (${code}). Supply what the message names, then call again; the same call unchanged returns this answer.`,
    };
  }
  return {
    retry: "never",
    wakeBy: { kind: "authority-change" },
    reason: `${toolName} was refused (${code}). The same call cannot succeed until the caller's grants, room or arguments change.`,
  };
}

function withNextAction(result: GovernedExecuteResult, next: RefusalNextAction): GovernedExecuteResult {
  const data = result.data ?? {};
  return {
    ...result,
    data: {
      ...data,
      // A handler that already named its next step keeps it; `retry` is added
      // regardless so every refusal answers "may I call this again?".
      ...(data["nextAction"] === undefined ? { nextAction: next } : {}),
      retry: next.retry,
    },
  };
}

// Same shape on every install and every run: keys sorted, arrays in order.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export type RefusalBreakerKeyInput = {
  userId: string;
  agentId?: string | null;
  toolName: string;
  params: Record<string, unknown>;
  /** The authority inputs: grants, room, role. A change here is a different call. */
  facts: unknown;
};

export function refusalBreakerKey(input: RefusalBreakerKeyInput): string {
  const material = JSON.stringify(canonical({
    userId: input.userId, agentId: input.agentId ?? null, toolName: input.toolName,
    params: input.params, facts: input.facts,
  }));
  return createHash("sha256").update(material).digest("hex");
}

export type RefusalBreakerCall = {
  toolName: string;
  /** Who is calling: the agent acting for a human, or the human alone. */
  principal: string;
  agentId?: string | null;
  /** Whether the tool writes; a successful write by a principal can be the input it lacked. */
  sideEffect: boolean;
};

export type RefusalBreakerTrip = {
  key: string;
  toolName: string;
  code: string;
  disposition: ParkableDisposition;
  principal: string;
  agentId: string | null;
  refusals: number;
  firstRefusedAt: string;
};

type Entry = {
  call: RefusalBreakerCall;
  result: GovernedExecuteResult;
  code: string;
  disposition: ParkableDisposition;
  firstAt: number;
  parkUntil: number;
  refusals: number;
  parkedCalls: number;
  envelopeId: string | null;
};

export type RefusalBreakerDeps = {
  now: () => number;
  /** Status of an approval request, read only to learn whether it is still pending. */
  envelopeStatus: (envelopeId: string) => Promise<{ status: string; expiresAt: Date | null } | null>;
  recordTrip: (trip: RefusalBreakerTrip) => Promise<void>;
};

export type RefusalBreaker = {
  /** The parked answer for this key, or null when the call must be evaluated. */
  parked(key: string): Promise<GovernedExecuteResult | null>;
  /** Record an evaluated result and return it with its nextAction attached. */
  observe(key: string, call: RefusalBreakerCall, result: GovernedExecuteResult, options?: { park?: boolean }): GovernedExecuteResult;
  clear(): void;
};

/** Is this result a parked repeat rather than a fresh evaluation? */
export function isParkedRefusal(result: unknown): boolean {
  if (!isRecord(result)) return false;
  const governance = result["governance"];
  return isRecord(governance) && isRecord(governance["parked"]);
}

async function defaultEnvelopeStatus(envelopeId: string) {
  const { prisma } = await import("@dpf/db");
  return prisma.coworkerActionEnvelope.findUnique({ where: { id: envelopeId }, select: { status: true, expiresAt: true } });
}

async function defaultRecordTrip(trip: RefusalBreakerTrip): Promise<void> {
  const { createOrTouchImprovementSignal } = await import("@/lib/improvement-flywheel/signals");
  await createOrTouchImprovementSignal({
    sourceType: "refusal_breaker",
    // One signal per tool, code and principal: every trip of the same refusal
    // touches it, and the third files one backlog item rather than thousands.
    sourceId: `${trip.toolName}:${trip.code}:${trip.principal}`,
    title: `${trip.toolName} was retried after ${trip.code} for ${trip.principal}; the refusal breaker parked it`,
    description: `An identical call was refused ${trip.refusals} time(s) from ${trip.firstRefusedAt} and then called again unchanged. `
      + `The breaker returned the recorded refusal without re-evaluating it (BI-E458A9CB). `
      + `The caller either lacks a grant it keeps needing, or ignores the refusal's nextAction.`,
    toolName: trip.toolName,
    agentId: trip.agentId,
    evidence: { ...trip, tool: trip.toolName, errorCode: trip.code },
    suspectedRootCause: trip.disposition === "refused"
      ? "A capability the caller's work needs is not granted, or the work routes to the wrong executor."
      : "The caller does not act on the refusal's nextAction.",
  });
}

export function createRefusalBreaker(overrides: Partial<RefusalBreakerDeps> = {}): RefusalBreaker {
  const deps: RefusalBreakerDeps = {
    now: overrides.now ?? Date.now,
    envelopeStatus: overrides.envelopeStatus ?? defaultEnvelopeStatus,
    recordTrip: overrides.recordTrip ?? defaultRecordTrip,
  };
  const entries = new Map<string, Entry>();

  async function stillPending(entry: Entry, now: number): Promise<boolean> {
    if (!entry.envelopeId) return now < entry.parkUntil;
    // A failed read must not hold an approved call: evaluate it instead.
    const envelope = await deps.envelopeStatus(entry.envelopeId).catch(() => null);
    return envelope?.status === "proposed" && (!envelope.expiresAt || envelope.expiresAt.getTime() > now);
  }

  function trip(key: string, entry: Entry): void {
    void deps.recordTrip({
      key, toolName: entry.call.toolName, code: entry.code, disposition: entry.disposition,
      principal: entry.call.principal, agentId: entry.call.agentId ?? null,
      refusals: entry.refusals, firstRefusedAt: new Date(entry.firstAt).toISOString(),
    }).catch((err: unknown) => {
      console.error("[refusal-breaker] trip signal failed tool=%s: %s", JSON.stringify(entry.call.toolName),
        JSON.stringify(err instanceof Error ? err.message : String(err)));
    });
  }

  return {
    async parked(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      const now = deps.now();
      if (!(await stillPending(entry, now))) {
        // Inconclusive keeps its repeat count so the next back-off doubles.
        if (entry.disposition !== "inconclusive") entries.delete(key);
        else entry.parkUntil = 0;
        return null;
      }
      entry.parkedCalls += 1;
      if (entry.parkedCalls === 1) trip(key, entry);
      const next = refusalNextAction(entry.call.toolName, entry.result, entry.refusals);
      const parkedUntil = entry.envelopeId ? null : new Date(entry.parkUntil).toISOString();
      const base = next ? withNextAction(entry.result, next) : entry.result;
      return {
        ...base,
        message: `Not evaluated again: this identical call was already answered ${entry.code} `
          + `(${entry.refusals}× since ${new Date(entry.firstAt).toISOString()}). `
          + (next?.retry === "after" ? `Retry after ${parkedUntil}. ` : "Calling it again unchanged returns this same answer. ")
          + entry.result.message,
        governance: {
          ...entry.result.governance,
          parked: { refusals: entry.refusals, parkedCalls: entry.parkedCalls, parkedUntil },
        },
      };
    },

    observe(key, call, result, options) {
      const now = deps.now();
      if (result.success) {
        entries.delete(key);
        if (call.sideEffect) {
          for (const [other, entry] of entries) {
            if (entry.disposition === "awaiting-input" && entry.call.principal === call.principal) entries.delete(other);
          }
        }
        return result;
      }
      const disposition = dispositionOf(result);
      if (!disposition) return result;
      if (options?.park === false) {
        const next = refusalNextAction(call.toolName, result);
        return next ? withNextAction(result, next) : result;
      }
      const code = result.error ?? "refused";
      const previous = entries.get(key);
      const repeat = previous && previous.code === code ? previous.refusals + 1 : 1;
      // The first inconclusive answer is not parked: an infrastructure blip
      // (BI-5B34D277's unresumable task) clears on the next call. Repeats back off.
      const window = disposition === "inconclusive" ? (repeat === 1 ? 0 : inconclusiveBackoffMs(repeat - 1))
        : disposition === "awaiting-input" ? AWAITING_INPUT_WINDOW_MS
        : REFUSED_WINDOW_MS;
      entries.delete(key);
      if (entries.size >= MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, {
        call, result, code, disposition,
        firstAt: repeat > 1 && previous ? previous.firstAt : now,
        parkUntil: now + window,
        refusals: repeat,
        parkedCalls: 0,
        envelopeId: disposition === "awaiting-person" ? envelopeIdOf(result) : null,
      });
      const next = refusalNextAction(call.toolName, result, repeat);
      return next ? withNextAction(result, next) : result;
    },

    clear() {
      entries.clear();
    },
  };
}

// ── the governed-execute seam ────────────────────────────────────────────────

let shared: RefusalBreaker = createRefusalBreaker();

/** Test seam: a fresh breaker per test, optionally with injected deps; null restores the default. */
export function resetRefusalBreakerForTests(overrides: Partial<RefusalBreakerDeps> | null): void {
  shared = createRefusalBreaker(overrides ?? {});
}

export type RefusalBreakerSeam = {
  resolveGrants: (agentId: string) => Promise<string[]>;
  sideEffectOf: (toolName: string) => boolean;
  /**
   * True when this run spent a person's approval. Its retry is already answered
   * from the approval's recorded outcome (BI-5B34D277), so it is not parked here.
   */
  approvalHeld?: () => boolean;
};

/**
 * Which calls the breaker covers, and their key. Executor calls only: a
 * coworker, an MCP token, or any non-REST transport. A person driving the
 * REST surface directly is not a retry loop, and is answered fresh each time.
 */
export async function refusalBreakerScope(
  args: GovernedExecuteArgs,
  seam: RefusalBreakerSeam,
): Promise<{ key: string; call: RefusalBreakerCall } | null> {
  const ctx = args.context;
  if (!ctx?.agentId && !ctx?.apiTokenId && args.source === "rest") return null;
  const toolName = canonicalWorkroomToolName(args.toolName);
  const facts = {
    grants: ctx?.agentId ? [...await seam.resolveGrants(ctx.agentId)].sort() : null,
    room: ctx?.roomAuthority?.workroomId ?? null,
    roomGrants: ctx?.roomAuthority?.authorizedGrants ?? null,
    role: args.userContext.platformRole ?? null,
    superuser: args.userContext.isSuperuser ?? null,
    tokenScope: ctx?.tokenScope ?? null,
    tokenGrantScopes: ctx?.tokenGrantScopes ?? null,
    delegation: ctx?.connectionDelegation?.authorityBindingId ?? null,
  };
  return {
    key: refusalBreakerKey({ userId: args.userId, agentId: ctx?.agentId, toolName, params: args.rawParams, facts }),
    call: {
      toolName,
      principal: ctx?.agentId ? `${ctx.agentId}@${args.userId}` : args.userId,
      agentId: ctx?.agentId ?? null,
      sideEffect: seam.sideEffectOf(toolName),
    },
  };
}

/** Run one governed call behind the breaker: a parked repeat is answered without evaluating it. */
export async function withRefusalBreaker(
  args: GovernedExecuteArgs,
  seam: RefusalBreakerSeam,
  evaluate: () => Promise<GovernedExecuteResult>,
): Promise<GovernedExecuteResult> {
  const scope = await refusalBreakerScope(args, seam);
  if (!scope) return evaluate();
  const parked = await shared.parked(scope.key);
  if (parked) return parked;
  const result = await evaluate();
  return shared.observe(scope.key, scope.call, result, { park: !seam.approvalHeld?.() });
}
