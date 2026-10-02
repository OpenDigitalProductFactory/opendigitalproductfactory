import { describe, expect, it } from "vitest";
import { createTrustedLoop, advanceTrustedLoop, runTrustedAgentExamples } from "./index";
import { trustedAgentExample } from "./trusted-agent-examples";

function scenario(change?: (f: ReturnType<typeof trustedAgentExample>) => void) {
  const f = trustedAgentExample();
  change?.(f);
  const created = createTrustedLoop({ work: f.work, profile: f.profile, binding: f.binding, stageId: "review", optionId: "review-change", attemptId: "attempt-1", now: f.now });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("Valid fixture must create a loop");
  let state = created.state;
  const event = (kind: string, fields = {}) => ({ kind, now: f.now, binding: f.binding, attemptId: state.attemptId, ...fields });
  const send = (kind: string, fields = {}) => {
    const result = advanceTrustedLoop(state, event(kind, fields));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Valid fixture event rejected");
    state = result.state;
    return result;
  };
  const authorized = () => { send("begin"); send("decision", { decision: f.decision }); return send("authorization", { disposition: "proceed", authorizationRef: f.ref("authorization"), expiresAt: "2026-10-01T00:01:00Z" }); };
  const dispatched = () => { authorized(); return send("reservation", { reserved: true, reservationRef: f.ref("reservation") }); };
  const observe = (observation: "unknown" | "succeeded" | "no-effect" | "not-submitted") => send("observation", { receipt: { ...f.receipt, attemptId: state.attemptId, observation, evidence: observation === "unknown" ? [] : [f.ref("target-proof")] } });
  return { f, event, send, authorized, dispatched, observe, state: () => state };
}

describe("portable reference loop (CT-03..06)", () => {
  it("orders scoped decision, fresh authorization, durable reservation, mediated dispatch and recording", () => {
    const s = scenario();
    expect(s.state().phase).toBe("ready");
    expect(s.send("begin").commands).toMatchObject([{ kind: "request-decision", scope: "wwmd" }]);
    expect(s.send("decision", { decision: s.f.decision }).commands).toMatchObject([{ kind: "request-authorization" }]);
    expect(s.send("authorization", { disposition: "proceed", authorizationRef: s.f.ref("authorization"), expiresAt: "2026-10-01T00:01:00Z" }).commands).toMatchObject([{ kind: "reserve-effect" }]);
    const dispatch = s.send("reservation", { reserved: true, reservationRef: s.f.ref("reservation") });
    expect(dispatch.commands).toMatchObject([{ kind: "mediated-dispatch", recheckAtUse: true, reservationRef: s.f.ref("reservation") }]);
    expect(s.observe("succeeded")).toMatchObject({ state: { phase: "stopped", disposition: "proceed", observation: "succeeded" }, commands: [{ kind: "record-outcome" }] });
  });
  it("preserves a refusal and typed waits without dispatch", () => {
    for (const disposition of ["refused", "awaiting-person", "awaiting-input", "inconclusive"] as const) {
      const s = scenario(); s.send("begin");
      const { selectedOptionId: _, ...decision } = s.f.decision;
      expect(s.send("decision", { decision: { ...decision, disposition, resolverRef: s.f.ref("resolver") } })).toMatchObject({ state: { phase: "stopped", disposition }, commands: [{ kind: "hold" }] });
    }
  });
  it("rejects decision scope or selected action mismatch", () => {
    for (const change of [{ scope: "wwwd" }, { selectedOptionId: "other", eligibleOptionIds: ["other"] }]) {
      const s = scenario(); s.send("begin");
      expect(advanceTrustedLoop(s.state(), s.event("decision", { decision: { ...s.f.decision, ...change } })).ok).toBe(false);
    }
  });
  it.each(["actorRef", "toolRef", "targetRef", "accountRef", "workRef", "profileRef"] as const)("rejects a changed %s at authorization", field => {
    const s = scenario(); s.send("begin"); s.send("decision", { decision: s.f.decision });
    const result = advanceTrustedLoop(s.state(), s.event("authorization", { disposition: "proceed", authorizationRef: s.f.ref("authorization"), expiresAt: "2026-10-01T00:01:00Z", binding: { ...s.f.binding, [field]: s.f.ref("changed") } }));
    expect(result.ok).toBe(false);
  });
  it("rejects wrong-order, duplicate and changed-attempt events", () => {
    const s = scenario();
    expect(advanceTrustedLoop(s.state(), s.event("reservation", { reserved: true, reservationRef: s.f.ref("reservation") })).ok).toBe(false);
    s.dispatched();
    expect(advanceTrustedLoop(s.state(), s.event("reservation", { reserved: true, reservationRef: s.f.ref("reservation") })).ok).toBe(false);
    expect(advanceTrustedLoop(s.state(), s.event("observation", { attemptId: "different", receipt: s.f.receipt })).ok).toBe(false);
    s.observe("succeeded");
    expect(advanceTrustedLoop(s.state(), s.event("observation", { receipt: { ...s.f.receipt, observation: "succeeded", evidence: [s.f.ref("proof")] } })).ok).toBe(false);
  });
  it("does not dispatch expired authority or a refused reservation", () => {
    const s = scenario(); s.authorized();
    expect(s.send("reservation", { now: "2026-10-01T00:02:00Z", reserved: true, reservationRef: s.f.ref("reservation") })).toMatchObject({ state: { phase: "stopped", disposition: "awaiting-input" }, commands: [{ kind: "hold" }] });
    const t = scenario(); t.authorized();
    expect(t.send("reservation", { reserved: false })).toMatchObject({ state: { phase: "stopped", disposition: "inconclusive" }, commands: [{ kind: "hold" }] });
  });
  it("recovers a possibly dispatched effect by reconciliation across JSON restart", () => {
    const s = scenario(); s.dispatched();
    const restarted = JSON.parse(JSON.stringify(s.state()));
    expect(advanceTrustedLoop(restarted, s.event("recover"))).toMatchObject({ state: { phase: "awaiting-reconciliation", observation: "unknown" }, commands: [{ kind: "reconcile-effect", binding: s.f.binding }] });
    expect(s.observe("unknown")).toMatchObject({ state: { phase: "awaiting-reconciliation" }, commands: [{ kind: "record-outcome" }, { kind: "reconcile-effect" }] });
    expect(advanceTrustedLoop(s.state(), s.event("retry", { nextAttemptId: "attempt-2" })).ok).toBe(false);
  });
  it("reconciles after revocation but a retry needs new identity and current authorization", () => {
    const s = scenario(); s.dispatched(); s.observe("unknown");
    expect(s.send("revoked")).toMatchObject({ state: { phase: "awaiting-reconciliation", revoked: true }, commands: [{ kind: "hold" }] });
    s.observe("no-effect");
    expect(advanceTrustedLoop(s.state(), s.event("retry", { nextAttemptId: "attempt-1" })).ok).toBe(false);
    expect(s.send("retry", { nextAttemptId: "attempt-2" })).toMatchObject({ state: { phase: "awaiting-authorization", attemptId: "attempt-2", binding: s.f.binding }, commands: [{ kind: "request-authorization" }] });
    expect(s.send("authorization", { disposition: "refused", authorizationRef: s.f.ref("revocation"), resolverRef: s.f.ref("owner") })).toMatchObject({ state: { phase: "stopped", disposition: "refused" } });
  });
  it("honors cancellation while still recording the uncertain effect", () => {
    const s = scenario(); s.dispatched();
    expect(s.send("cancel")).toMatchObject({ state: { phase: "awaiting-reconciliation", cancelled: true, observation: "unknown" } });
    expect(s.observe("no-effect")).toMatchObject({ state: { phase: "stopped", disposition: "awaiting-input" }, commands: [{ kind: "record-outcome" }, { kind: "hold" }] });
    expect(advanceTrustedLoop(s.state(), s.event("retry", { nextAttemptId: "attempt-2" })).ok).toBe(false);
  });
  it("holds unknown effects when reconciliation budget is exhausted", () => {
    const s = scenario(); s.dispatched();
    for (let i = 0; i < 3; i++) s.observe("unknown");
    expect(s.observe("unknown")).toMatchObject({ state: { phase: "stopped", observation: "unknown", disposition: "inconclusive", resolverRef: s.f.ref("owner") }, commands: [{ kind: "record-outcome" }, { kind: "hold" }] });
  });
  it("fails closed on malformed persisted state and unsupported events", () => {
    const s = scenario();
    for (const state of [null, { ...s.state(), phase: "awaiting-dispatch" }, { ...s.state(), steps: -1 }]) expect(advanceTrustedLoop(state, s.event("recover")).ok).toBe(false);
    expect(advanceTrustedLoop(s.state(), s.event("arbitrary"))).toMatchObject({ ok: false });
  });
  it.each(["effectId", "argumentDigest", "canonicalization", "purpose", "policyGeneration"] as const)("rejects changed scalar binding %s", field => {
    const s = scenario(); s.dispatched();
    const changed = field === "argumentDigest" ? "sha256:" + "b".repeat(64) : "changed";
    expect(advanceTrustedLoop(s.state(), s.event("recover", { binding: { ...s.f.binding, [field]: changed } })).ok).toBe(false);
  });
  it("checks GPP binding revision independently of the unchanged shape", () => {
    const s = scenario(f => {
      const gpp = { bindingRef: f.ref("gpp"), shapeRef: f.work.activity, stageId: "review", scope: "wwmd" as const, gateDecisionRef: f.ref("gate"), mode: "enforce" as const, observedAt: f.now };
      f.work.gpp = true; f.work.stages[0]!.gppBindings = [gpp]; f.binding.gppBindings = [gpp];
    });
    s.dispatched();
    const binding = structuredClone(s.f.binding); binding.gppBindings[0]!.bindingRef.version = "2";
    expect(advanceTrustedLoop(s.state(), s.event("recover", { binding }))).toMatchObject({ ok: false, error: "binding-changed" });
  });
  it("holds shadow-mode GPP instead of claiming enforcement", () => {
    const s = scenario(f => {
      const gpp = { bindingRef: f.ref("gpp"), shapeRef: f.work.activity, stageId: "review", scope: "wwmd" as const, gateDecisionRef: f.ref("gate"), mode: "shadow" as const, observedAt: f.now };
      f.work.gpp = true; f.work.stages[0]!.gppBindings = [gpp]; f.binding.gppBindings = [gpp];
    });
    expect(s.state()).toMatchObject({ phase: "stopped", disposition: "awaiting-input", reason: "gpp-enforcement-unproven" });
  });
  it("holds at step and attempt bounds without denying the business objective", () => {
    const s = scenario(f => { f.work.limits.steps = 1; }); s.send("begin");
    expect(s.send("decision", { decision: s.f.decision })).toMatchObject({ state: { phase: "stopped", disposition: "inconclusive", reason: "step-budget-exhausted" } });
    const t = scenario(f => { f.work.limits.attempts = 1; }); t.dispatched(); t.observe("no-effect");
    expect(t.send("retry", { nextAttemptId: "attempt-2" })).toMatchObject({ state: { phase: "stopped", disposition: "inconclusive", reason: "attempt-budget-exhausted" } });
  });
  it("requires declared evidence before proceeding", () => {
    const s = scenario(f => { f.work.requiredEvidence = [f.ref("required")]; }); s.send("begin");
    expect(advanceTrustedLoop(s.state(), s.event("decision", { decision: s.f.decision }))).toMatchObject({ ok: false, error: "invalid-decision" });
  });
  it("rejects receipts for another decision or authorization", () => {
    const s = scenario(); s.dispatched();
    for (const field of ["decisionRef", "authorizationRef"] as const) {
      expect(advanceTrustedLoop(s.state(), s.event("observation", { receipt: { ...s.f.receipt, [field]: s.f.ref("other") } }))).toMatchObject({ ok: false, error: "invalid-receipt" });
    }
  });
  it("requires renewal when source restrictions expire", () => {
    const s = scenario(f => { f.work.restrictions.expiresAt = "2026-10-01T00:00:30Z"; }); s.authorized();
    expect(s.send("reservation", { now: "2026-10-01T00:00:40Z", reserved: true, reservationRef: s.f.ref("reservation") })).toMatchObject({ state: { disposition: "awaiting-input", reason: "source-policy-expired" }, commands: [{ kind: "hold" }] });
  });
  it("accepts reordered JSON properties without weakening exact binding", () => {
    const s = scenario();
    expect(advanceTrustedLoop(s.state(), s.event("begin", { binding: Object.fromEntries(Object.entries(s.f.binding).reverse()) })).ok).toBe(true);
  });
  it("returns a structured error for adversarial accessors", () => {
    const s = scenario();
    const input = new Proxy(s.state(), { get() { throw new Error("getter"); } });
    expect(() => advanceTrustedLoop(input, s.event("begin"))).not.toThrow();
    expect(advanceTrustedLoop(input, s.event("begin")).ok).toBe(false);
  });

});

it("runs the standalone simulated examples through public exports (CT-08)", () => {
  const demo = runTrustedAgentExamples();
  expect(demo).toMatchObject({ simulated: true, conformanceClaim: "none", success: { ok: true, state: { observation: "succeeded" } }, refusal: { ok: true, state: { disposition: "refused" } }, scopeMismatch: { ok: false }, unknown: { ok: true, state: { observation: "unknown" } }, retry: { ok: true, state: { attemptId: "attempt-2", phase: "awaiting-authorization" } }, optionalExtension: { ok: true }, mandatoryExtension: { ok: false } });
});
