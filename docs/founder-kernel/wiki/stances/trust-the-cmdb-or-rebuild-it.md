---
title: Trust your data spine or rebuild it on the three pillars
pageKind: stance
status: published
abstract: A coworker's decisions are only as trustworthy as the record beneath them. A trusted data spine rests on three pillars — Ingestion (auto-populate), Insight (actually use it), and Governance & Health (someone owns and prunes it). Miss any pillar and the record is lying to you. The CMDB is the war-story where this lesson was learned.
sources:
  - frameworks/csdm
---

## The position

Any system that reasons off a record of what an organisation runs — a CMDB, a `[[entities/digital-product]]` model, DPF&#39;s own canonical data spine — is **only as trustworthy as that record**. Most organisations have such a record. Very few actually trust it. **Trust is the only quality of the record that matters** — an untrusted spine is technical debt that compounds, and every decision grounded on it inherits the lie.

Trust rests on three pillars:

1. **Ingestion** — auto-populate. It is not humanly possible to manually track the rapid inflation and deflation of virtualised cloud resources, hybrid environments, and on-premises infrastructure.
2. **Insight** — actually use the data for operations and planning. A record nobody queries is a record nobody fixes.
3. **Governance &amp; Health** — people and process, not just tech. Someone has to own the model, someone has to triage discoveries, someone has to retire stale rows.

If any pillar is missing, the record is lying to you — and acting on it produces wrong decisions you&#39;ll only discover months later.

## Why

In DPF this is not an analogy — it is the acceptance test for the platform&#39;s own spine. DPF&#39;s coworkers reason off its canonical data model the way an ITSM team reasons off a CMDB. So the three pillars apply directly: if DPF&#39;s model isn&#39;t auto-populated (Ingestion), actually used by the coworkers making calls (Insight), and owned and pruned (Governance), then every `[[stances/ea-is-meteorology]]` forecast — every WWMD, WWWD, and WSID recommendation — is grounded on decoration. A decision surface is only as trustworthy as the record beneath it; this stance is that constraint made explicit.

The failure is never that the data model is hard. `[[entities/csdm]]` (currently at v5) settled the model question a decade ago. The failure is standing up the model without standing up the three pillars, then being surprised when the record stops being useful.

### The war-story: the CMDB and technical-debt reporting

The lesson originally landed on the CMDB. The early ServiceNow Technology Portfolio Management work hit the wall on technical-debt reporting because there was no single source of truth across asset, dev, ops, ITSM, and CSM. **The vision was to create a common model that connects what naturally happens. CSDM was born.** The same lesson replayed across every customer: model alone isn&#39;t enough.

The ROI conversation that landed with executives was tool consolidation — organisations routinely run 300+ tools doing the same IT function (monitoring is the canonical example), and you can&#39;t rationalise that without a trusted record to tell you which tool does what. Build the three pillars; the rationalisation funds itself. "CMDB" was simply the ITSM name for *the record of what you run* — the pillars are the same wherever that record lives.

## When this applies

- Designing data foundations for cross-product reasoning, AI coworkers, or rationalisation initiatives — including DPF&#39;s own canonical model.
- Standing up a new CMDB, or rescuing one that&#39;s lost the team&#39;s trust.
- Any decision surface whose recommendations are only as good as the record they read from.

## When it doesn&#39;t

- Small organisations where the manual-tracking burden is genuinely tractable (rare; usually self-deception).
- Read-only reporting use cases where stale data is acceptable.

## Heuristics derived from this stance

- `[[heuristics/auto-populate-or-its-wrong]]` — the first pillar in operational form.
- `[[heuristics/model-what-naturally-happens]]` — how to build the data model without becoming a data-lake project.

## See also

- Entity: `[[entities/csdm]]`
- Stance: `[[stances/dont-integrate-ea-platform]]` — why one trusted record beats two integrated ones.
- Stance: `[[stances/ea-is-meteorology]]` — the forecast inherits the trust of the record beneath it.
- Raw source: `[raw-sources/frameworks/csdm](../../raw-sources/frameworks/csdm.md)`
