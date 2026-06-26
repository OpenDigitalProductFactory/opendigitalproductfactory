# Trust-graduation core — implementation note

- **Epic:** EP-8AF1C996 (Progressive Autonomy & Trust Graduation)
- **BI:** BI-DE4BF92F (the foundation)
- **Full design:** `2026-06-26-progressive-autonomy-trust-graduation-design.md`
- **Date:** 2026-06-26

Implements the pure **decision core** of the trust dial:
`apps/web/lib/autonomy/trust-graduation.ts` —
`recommendTrustChange({ level, risk, window })` returns `hold | promote | demote`
for one `(coworker x activity x risk)`, honoring:

- **symmetric demotion first** (a bad track record drops a level — safety before promotion),
- the **risk ceiling** (`outbound-or-floor` capped at `propose` forever; the kernel floor),
- the **promotion gate** (agreement rate over a minimum sample count).

It is pure + deterministic and **returns a recommendation only — it never acts or
auto-applies**; a human confirms a promotion. Thresholds (`DEFAULT_THRESHOLDS`)
and ceilings (`DEFAULT_RISK_CEILINGS`) are exported, named, and overridable = the
tunable dial.

## Open founder questions surfaced as config (not hard-coded guesses)

- `DEFAULT_RISK_CEILINGS["internal-irreversible"]` defaults to `autopilot`; the
  open question (cap state-mutating actions at `supervised`?) is a one-line config
  change, covered by a unit test exercising the override.
- `DEFAULT_THRESHOLDS` values are the design-pass defaults; tune per risk appetite.

## Regulatory ceiling — now integrated (BI-40CD8ACD)

`recommendTrustChange` now takes an optional `regulatoryCeiling`, and the EFFECTIVE
cap = `minLevel(riskCeiling, regulatoryCeiling)`. So a regulated activity stays
capped regardless of agreement ("only a compliance change lifts it"), while the
risk floor still binds when it is the more restrictive of the two. Omit the param
for non-regulated activities (trust + risk govern alone). The policy DATA layer —
which (industry x jurisdiction x activity) maps to which ceiling, versioned and
compliance-editable — remains a separate build needing the founder's domain input.

## Deferred (separate BIs)

The DB substrate (`DecisionShadowLedger` + `TrustState` models, recording hooks,
the reconciliation pass that fills actual-vs-proposed and computes agreement), the
graduation evaluator UI, and wiring real activities into shadow mode (first tenant:
the auto-nomination loop BI-A028AA14) — all per the full design pass. Nothing in
this PR causes any activity to act.
