# Architecture Hardening — Session Plan

**Epic (single program home):** `EP-413F2602` — Whole-Platform Architecture Hardening  
**Program BI:** `BI-C04CAD7F`  
**Charter findings:** [`docs/architecture/2026-08-09-portal-architecture-hardening-findings.md`](../../architecture/2026-08-09-portal-architecture-hardening-findings.md)  
**Roadmap BI:** `BI-D938AB7A`  
**Date:** 2026-08-09 (live backlog organized 2026-08-10)

This plan sequences **future sessions**. It does not implement hardening. Re-query live backlog before claiming a BI — statuses expire.

---

## How to use this plan

1. Open **one session per row** (or one workstream if the session is long).
2. Claim the listed BI(s) via MCP WorkCapsule / backlog claim tools.
3. Work from a **sibling worktree**, not the install root clone.
4. Prefer mapping to existing BIs over filing new ones; file only after substrate check.
5. Leave execution evidence on the BI; update this plan only when sequencing changes.

---

## Session sequence

| Session | Priority | Theme | Primary BI(s) | Status at organize time | Done when |
| --- | --- | --- | --- | --- | --- |
| **S0** | — | Program map (this doc) | `BI-D938AB7A` | triaging→build | Plan file committed; epic `planPath` set |
| **S1** | P0 | Sole-platform operational readiness verdict | `BI-903F5A94` | in-progress | Typed readiness verdict from upgrade/DR/health evidence; gaps listed as degradations |
| **S2** | P0 | Archetype readiness matrix + claim gate | `BI-C1C706F1` | in-progress | Matrix + `evaluateArchetypeReadinessClaim` consumed by at least one claim surface; tests green |
| **S3** | P0 | Operator readiness matrix surface | `BI-1A222A7A` | in-progress | Operator-readable surface for tiers/blockers without overclaim |
| **S4** | P0 | Born-bounded install resources | `BI-4F3AB6B3` | open | WSL/compose ceilings + install preflight + resource release-gate contract |
| **S5** | P0 | BuildKit session lifecycle (idle RAM) | `BI-C85D1B0A` | in-progress (PR #4168 merging 2026-08-10) | Stop-after-grace + budgeted cache; obsolete builders reaped; post-merge: self-upgrade + janitor apply + pregate smoke |
| **S6** | P1 | Whole-account export (domain-coordinated) | `BI-4C16947C` | in-progress | **Keep `EP-DATA-GOVERNANCE` semantics** if re-linked later; restore-grade package + verifier |
| **S7** | P1 | Universal AI action envelope | `BI-35E9EE62` | in-progress | **Domain epic `EP-2984B02B`** for Work Case substrate; contract + matrix land; child gaps filed |
| **S8** | P1 | Self-upgrade reliability blockers (sample) | `BI-AF4D4F23`, `BI-ADCD66D1`, `BI-D47955AF`, `BI-9A00FBC4` | mixed | Navigation-safe observation + retry + unattended remediation path; **remain under `EP-UPGRADE-LIFECYCLE` unless re-homed** |
| **S9** | P2 | Silent collection caps | `BI-72C3FBA2` | new | Demand-response canary not silent; inventory + regression test |
| **S10** | P2 | ActorContext + Finance canary | `BI-963F4226` → `BI-58810028` | open | Transport-neutral contract + finance canary |
| **S11** | P2 | API/server-action decoupling + hotspots | `BI-71345FF0`, `BI-B970B01D` | open | Reverse deps reduced; exceptions baseline shrinks |
| **S12** | P2 | Observability product decision | `BI-PSC-008` | open | OTel graduate vs lean profile decided + implemented path |
| **S13** | P2 | TTS idle / lean sidecars | `BI-A0A0568F` | open | Idle TTS not always-on multi-GiB without product value |
| **S14** | P3 | Living architecture inventory gate | `BI-FDA5DC4C` | open | Generated inventory + topology drift gate |
| **S15** | P3 | Debt budgets with expiry | `BI-7B803E60` | open | Owned burn-down budgets, review dates |
| **S16** | P3 | Data-model conformance ratchets | `BI-5881E707` | open | FK/orphan/owned-model ratchets |
| **S17** | P3 | Architecture fitness suite | `BI-1F3E083E` | open | ISO-aligned scenarios under governed lease |
| **S18** | P3 | Substrate durable execution / schema ownership (coordinated) | `BI-PSC-004`, `BI-PSC-005`, `BI-PSC-006` | open | May stay on `EP-PLATFORM-SUBSTRATE-CONVERGENCE` if re-split; still program dependencies |

---

## Workstream rollup (epic W0–W5)

| WS | Sessions | Focus |
| --- | --- | --- |
| W0 Coordination | S0 | Plan + `BI-C04CAD7F` evidence |
| W1 Sole-platform trust | S1–S3, S6–S7 | Readiness, claims, export, AI envelope |
| W2 Resource & build | S4–S5, S13 | Born-bounded + BuildKit + TTS |
| W3 Application structure | S10–S11, S14–S16 | ActorContext, debt, docs, data ratchets |
| W4 Scalability fitness | S9, S17 | Silent caps + fitness suite |
| W5 Observability | S12 | OTel / lean profile |

---

## Already done (do not re-file)

| BI | Note |
| --- | --- |
| `BI-2E9F6D37` | Application bounded-context DAG + guard |
| `BI-F7792FC1` | Reporting composition / raw-table ratchet |
| `BI-EA67A758` | Silent backup trial-restore operator alert (DR epic history) |
| `BI-PSC-001`…`003` | Substrate baseline, connector kernel, capability Compose |

---

## Explicit non-goals for future sessions

- Second architecture-hardening epic or umbrella BI set
- Re-opening commercial GTM thesis without readiness matrix evidence
- Implementing memory/build work outside `BI-C85D1B0A` / `BI-4F3AB6B3` / `BI-A0A0568F`
- Treating template archetype count as sole-platform readiness

---

## External coordination (not reparented as sole home)

These remain first-class on domain epics for substrate ownership but are **in scope for the program**:

| BI | Domain epic (default) | Why coordinated |
| --- | --- | --- |
| `BI-4C16947C` | `EP-DATA-GOVERNANCE` | Export must reuse DG primitives |
| `BI-35E9EE62` | `EP-2984B02B` | Action envelope reuses Work Case receipts |
| Upgrade/DR open set | `EP-UPGRADE-LIFECYCLE`, `EP-DR-HARDENING-2026-05-23` | Install lifecycle substrate |

As of organize pass, the following were **linked into `EP-413F2602`** for single-epic rollup:  
`BI-903F5A94`, `BI-C1C706F1`, `BI-1A222A7A`, `BI-C85D1B0A`, `BI-A0A0568F`, `BI-PSC-008`, plus native children of the epic, `BI-72C3FBA2`, `BI-D938AB7A`.

---

## Suggested first three sessions after S0

1. **S5** `BI-C85D1B0A` — continues recent memory/build work; high operator value.  
2. **S1** `BI-903F5A94` — sole-platform verdict unblocks honest ops claims.  
3. **S2/S3** readiness matrix + operator surface — claim control.

---

## Recovery

If conversation is lost: start at this file → list `EP-413F2602` live items → open findings doc → pick next open session row.
