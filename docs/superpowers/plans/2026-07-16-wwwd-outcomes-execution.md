# WWWD Outcomes Loop — execution plan (workstream D)

**Program:** [Living Business Excellence](../specs/2026-07-15-living-business-excellence-program-design.md) §2 (row D)
**Epic:** `EP-LIVING-BUSINESS-EXCELLENCE` · BIs `BI-36815303` (D-1, cog gate) · `BI-08C23C85` (D-2, outcome surface)
**Started:** 2026-07-16

## Why

The twin renders activity, but not *outcomes* — the proof the machine is producing. Workstream D
makes real customer outcomes visible and (D-1) routes the consequential decisions the twin surfaces
through the org's own WWWD stance.

## D-2 — the customer-outcome surface ✅ landed (`BI-08C23C85`)

The twin now carries an **outcomes strip** — revenue realized + work delivered — so the founder sees
value being produced, not just demand moving:

- `apps/web/components/twin/snapshot.ts` — `TwinOutcome` + optional `TwinSnapshot.outcomes`.
- `apps/web/lib/twin/living-business-snapshot.ts` — the **live** projection reads paid invoices
  (`Invoice.paidAt` within 90 days) → **Revenue in** + **Delivered** (count of settled+paid work).
- `apps/web/lib/twin/demo-business-snapshot.ts` — the demo bridge emits the same from the generated
  finance (paid invoices).
- `apps/web/components/twin/OutcomesStrip.tsx` — the render; `TwinView` shows it under the
  value-stream lane.

**Verified:** mapper test asserts `outcomes` (revenue + delivered) for all 94; loader structural
client extended with `invoice`; `apps/web` twin tests 19/19; typecheck clean. Live render pending a
port-forward pass (same discipline as C-2).

## D-1 — cog/quests through the WWWD gate (design note, `BI-36815303`)

`evaluateOrgBusinessDecisionGate` (`apps/web/lib/decision-perspective/org-business-gate.ts`) is a
**business-decision** gate — `{ question, options, domainClass, riskTier }` → `{ allowed, evaluation,
operatorMessage }` — and it **records a `DecisionInteraction` per call**. So it must NOT run on every
twin render (perf + semantics): the twin's routine allocation cog ("seat the next party") is not a
stance-gated business decision.

**Correct binding (follow-on):** gate the *action* when the operator confirms a cog proposal or acts
on a quest that IS a consequential business decision (e.g. "approve £X of bills", "authorise this
spend") — an action-time server action wrapping the gate, surfacing `operatorMessage` + the verdict.
This is interactive and needs the running auth'd app to verify end-to-end, so it is scoped as a
distinct follow-on rather than folded into the render path.

## Non-goals

- Not a new analytics warehouse (program spec §5): D surfaces the finance/work substrate the twin
  already touches (`Invoice`, `StorefrontBooking`), not a new store.
