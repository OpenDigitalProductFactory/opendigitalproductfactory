# Design research runbook

**Status:** procedure reference. The *rules* — research required in every spec, and the alignment checklist — live in [`AGENTS.md`](../../AGENTS.md) §7 and stay always-on. This file holds the checklist detail and worked examples. Relocated by BI-0020D511 Phase 1; no rule was dropped.

→ [kernel principle](../founder-kernel/wiki/principles/design-research-required.md)

Every new feature spec must include a "Research & Benchmarking" section before finalization. Compare 2–3 open-source leaders (read their data models, not just feature lists) and 2–3 commercial products. Document patterns adopted, patterns rejected, anti-patterns identified, and gaps the design fills. Reference specific projects, not abstract "best practices."

**Named comparators, so "2–3 open-source leaders" is not left to whoever is writing (BI-F7E620C8).** The requirement is satisfied in form and not in substance when an author reaches for whatever they happen to know and the nearest peer goes uncompared. Where DPF has an obvious category leader, name it:

| Spec category | Default comparator | Standing |
| --- | --- | --- |
| Delivery lifecycle, agentic process, gates, phase progression | **BMAD Method** (~53k stars, MIT, actively maintained) | Evaluated in full at [`docs/security/tool-evaluations/2026-09-15-bmad-method.md`](../security/tool-evaluations/2026-09-15-bmad-method.md) — **rejected as a dependency, adopted as a benchmark and idea source.** Citing it is not a step toward taking it on. |

It is the leader in DPF's own category, and no DPF spec cited it before [`2026-09-15-third-state-is-typed-addendum-design.md`](../superpowers/specs/2026-09-15-third-state-is-typed-addendum-design.md) §3, which is that adoption's first use. Compare against it for delivery-lifecycle work unless there is a reason not to — and say what DPF adopts *and* what it rejects, which is the part the rule actually turns on.

**Minimum Architectural Alignment Checklist (BI-IMP-25A07E52).** Before finalizing a feature spec (or rubber-stamping a PR that changes contracts), confirm:

1. **Deployment contracts** — if the change alters a public API response shape, install path, host-coupled default, service boundary, or self-upgrade step, review [`docs/superpowers/specs/2026-05-09-deployment-contracts.md`](../superpowers/specs/2026-05-09-deployment-contracts.md) and name the affected contract(s). Substrate-specific deltas stay in owning specs; universal rules stay in the doctrine.
2. **Canonical identity** — name/display/org identity reads from `Organization` (and Principal convergence for identity-bearing entities), not a parallel field. → §11 and [organization-canonical-identity](../professions/data-architect/wiki/organization-canonical-identity.md).
3. **No parallel utilities** — before adding a helper, verify the substrate (grep + code graph / `search_code_graph`) so existing shared modules are extended rather than duplicated. → [verify-substrate-before-proposing-new](../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md).
4. **This rulebook** — the change does not invent a second home for a rule already stated here or in a kernel principle; use pointers, not copies. → [single-source-of-truth](../founder-kernel/wiki/principles/single-source-of-truth.md).

**Validating prioritization against archetype load-bearing stages (BI-IMP-3EC2E558).** Specs that change global order, default priority, cockpit ranking, or storefront activation sequence for an industry archetype must check the **operational value stream** for that archetype — not invent a parallel stage list.

1. **Read the SSOT** — [`docs/architecture/archetype-business-value-streams.md`](../architecture/archetype-business-value-streams.md). Stable stage family: `attract · capture · qualify · deliver · settle · retain` (per-archetype load-bearing emphasis is named in that doc, not here).
2. **Checklist before shipping a global priority change** — (a) name the archetype(s) affected; (b) list which stream stages the change reorders or demotes; (c) confirm no **load-bearing** stage for those archetypes is pushed behind a non-load-bearing one without an explicit per-archetype policy override; (d) cite the section of the value-stream doc you checked.
3. **Per-archetype overrides** — when one industry must differ from the global default, document the override in the design (and seed/config owner), do not hardcode a second ranking table in a random page helper.
4. **Do not duplicate stage names** in AGENTS.md or feature specs — always point at the value-stream doc so stage vocabulary stays single-source.
