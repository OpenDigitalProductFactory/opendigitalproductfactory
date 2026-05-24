/**
 * POST /api/kernel/gate — runtime kernel-commandment gate endpoint.
 *
 * Spec: docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md §3.5
 * Plan: docs/superpowers/plans/2026-05-24-runtime-kernel-commandments-slice-1.md (Phase 4)
 *
 * Called by the shell guard (scripts/safety/dpf-shell-guard.sh) on every
 * intercepted command. The guard sends the ExecutionAttempt + session class;
 * we return the GateDecision verbatim. Pure orchestration — the real work
 * is in lib/kernel/runtime-gate.ts.
 *
 * Body schema:
 *   { attempt: ExecutionAttempt, sessionClass: "interactive" | "autonomous" }
 *
 * Response: GateDecision (allow | require_confirm | refuse), 200 on success,
 *           400 on malformed body.
 *
 * Emits dpf_kernel_gate_decisions_total Prometheus counter + a
 * [kernel-gate-trace] structured log on every call.
 */

import { z } from "zod";
import {
  evaluateExecution,
  type ExecutionAttempt,
  type SessionClass,
} from "@/lib/kernel/runtime-gate";
import { loadEnforceablePrinciples } from "@/lib/kernel/load-enforceable-principles";
import { kernelGateDecisionsTotal } from "@/lib/operate/metrics";

const BodySchema = z.object({
  attempt: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("shell"),    command: z.string(), args: z.array(z.string()) }),
    z.object({ kind: z.literal("mcp_tool"), toolName: z.string(), arguments: z.unknown() }),
    z.object({ kind: z.literal("sql"),      statement: z.string() }),
    z.object({ kind: z.literal("git"),      subcommand: z.string(), args: z.array(z.string()) }),
  ]),
  sessionClass: z.enum(["interactive", "autonomous"]),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const principles = await loadEnforceablePrinciples();
  const decision = evaluateExecution(
    parsed.data.attempt as ExecutionAttempt,
    parsed.data.sessionClass as SessionClass,
    principles,
  );

  const slug = decision.verdict === "allow" ? "_none" : decision.principleSlug;
  kernelGateDecisionsTotal.inc({
    verdict: decision.verdict,
    principle_slug: slug,
    session_class: parsed.data.sessionClass,
  });
  // CodeQL js/log-injection: bound values are validated by Zod above + the
  // enum'd verdict / session_class. Tool/command names are user-influenced;
  // JSON.stringify neutralises CR/LF in the trace line.
  // eslint-disable-next-line no-console
  console.log(
    "[kernel-gate-trace] verdict=%s slug=%s session=%s kind=%s",
    decision.verdict,
    slug,
    parsed.data.sessionClass,
    parsed.data.attempt.kind,
  );

  return Response.json(decision);
}
