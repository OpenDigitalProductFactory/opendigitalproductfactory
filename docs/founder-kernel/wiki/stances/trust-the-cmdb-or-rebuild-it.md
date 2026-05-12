---
title: Trust the CMDB or rebuild it on the three pillars
pageKind: stance
status: draft
abstract: Most organisations have a CMDB; very few actually trust it. Trust is built through Ingestion (auto-populate), Insight (actually use the data), and Governance & Health (people and process). If any pillar is missing, the CMDB is lying to you.
sources:
  - frameworks/csdm
---

## The position

Most organisations have a CMDB. Very few actually trust it. **Trust is the only quality of a CMDB that matters** — an untrusted CMDB is technical debt that compounds.

Trust rests on three pillars:

1. **Ingestion** — auto-populate. It is not humanly possible to manually track the rapid inflation and deflation of virtualised cloud resources, hybrid environments, and on-premises infrastructure.
2. **Insight** — actually use the data for operations and planning. A CMDB nobody queries is a CMDB nobody fixes.
3. **Governance &amp; Health** — people and process, not just tech. Someone has to own the model, someone has to triage discoveries, someone has to retire stale rows.

If any pillar is missing, the CMDB is lying to you — and acting on it produces wrong decisions you&#39;ll only discover months later.

## Why

The CMDB problem isn&#39;t that the data model is hard. `[[entities/csdm]]` (currently at v5) has settled the model question — it&#39;s the canonical spine. The problem is that organisations stand up the data model without standing up the three pillars, then are surprised when the CMDB stops being useful.

The technical-debt use case was where this lesson originally landed. The early ServiceNow Technology Portfolio Management work hit the wall on technical-debt reporting because there was no single source of truth across asset, dev, ops, ITSM, and CSM. **The vision was to create a common model that connects what naturally happens. CSDM was born.** The same lesson kept replaying across every customer: model alone isn&#39;t enough.

The ROI conversation that lands with executives is tool consolidation: organisations routinely have 300+ tools doing the same IT function (monitoring is the canonical example). You can&#39;t rationalise that without a trusted CMDB to tell you which tool does what. Build the three pillars; the rationalisation funds itself.

## When this applies

- Standing up a new CMDB.
- Rescuing a CMDB that&#39;s lost the team&#39;s trust.
- Designing data foundations for cross-product reasoning, AI co-workers, or rationalisation initiatives.

## When it doesn&#39;t

- Small organisations where the manual-tracking burden is genuinely tractable (rare; usually self-deception).
- Read-only reporting use cases where stale data is acceptable.

## Heuristics derived from this stance

- `[[heuristics/auto-populate-or-its-wrong]]` — the first pillar in operational form.
- `[[heuristics/model-what-naturally-happens]]` — how to build the data model without becoming a data-lake project.

## See also

- Entity: `[[entities/csdm]]`
- Stance: `[[stances/dont-integrate-ea-platform]]` — why one trusted CMDB beats two integrated ones.
- Raw source: `[[raw-sources/frameworks/csdm]]`
