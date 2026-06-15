# BIAN Reference — Service Landscape v14.0 + CSDM Integration

Banking Industry Architecture Network (BIAN) reference material backing DPF's banking
archetypes and the BIAN-sourced business-capability perspective. BIAN is the
vendor-neutral standards body for banking business architecture; its core deliverable is
the **Service Landscape** — a MECE decomposition of everything a bank does into discrete,
canonical **Service Domains**.

## Contents

| File | What it is |
| ---- | ---------- |
| [`bian-v14-service-landscape.json`](bian-v14-service-landscape.json) | The full BIAN v14.0 Service Landscape hierarchy — 8 Business Areas → 43 Business Domains → 341 Service Domains — extracted from the official Value Chain View, with the official one-line Service Domain descriptions merged in from BIAN's published Semantic API specifications (258 of 341 Service Domains have a published Semantic API in release 14.0.0). |
| [`../BIAN_CSDM_Integration_v76-US-English - FINAL.pdf`](../BIAN_CSDM_Integration_v76-US-English%20-%20FINAL.pdf) | "Bridging BIAN and ServiceNow CSDM" v7.6 (May 2026) — joint ServiceNow/BIAN discussion paper defining the BIAN→CSDM object mapping. Authors include BIAN's Lead Architect and ServiceNow's CSDM/CMDB product management. |

## Provenance

- **Value Chain View (hierarchy):** <https://bian.org/servicelandscape-14-0-0/views/view_54486.html> — the canonical v14 layout. BIAN is deprecating the older Matrix layout, which uses *different* Business Area / Business Domain terminology for the same Service Domains; do not mix the two vocabularies.
- **Semantic APIs (descriptions):** <https://github.com/bian-official/public> `release14.0.0/semantic-apis` (OAS 3.x, one spec per Service Domain). Detailed per-operation specs live on the BIAN portal: <https://portal.bian.org>.
- Retrieved 2026-06-09. Re-extract when BIAN publishes a new landscape release; `version` and `retrieved` fields in the JSON record what this snapshot reflects.

## The BIAN model in one page

- **Business Area** — broad grouping of related banking activity (8 in the v14 Value Chain View, e.g. *Customers*, *Products*, *Operations*).
- **Business Domain** — coherent collection of related functions used for performance analysis and strategic attribution (43, e.g. *Loans and Deposits*, *Relationship Management*).
- **Service Domain** — the fundamental building block: an *assignable responsibility partition* with a single well-defined purpose (341 in the Value Chain View). Each applies one of 19 **functional patterns** (Operate, Process, Analyse, …) to the asset it manages. Service Domains are **canonical**: *Customer Credit Rating* means the same thing in any bank, which is what makes cross-install analytics and core-vs-commodity classification trustworthy.
- **Service Operations / Semantic APIs** — the published contracts a Service Domain exposes to collaborating domains, characterized by Action Terms (Initiate, Retrieve, Evaluate, …) and published as REST-ready Semantic API specs.

## BIAN → CSDM mapping (from the integration paper)

The v7.6 paper scopes the integration to four BIAN objects and keeps both frameworks intact:

| BIAN object | CSDM object | Notes |
| ----------- | ----------- | ----- |
| Business Area | Business Capability (L0) | Existing capability hierarchy; `Category = 'BIAN Business Area'` |
| Business Domain | Business Capability (L1) | Child of the Business Area capability |
| Service Domain | Service Domain (custom CI) | The cornerstone — conceptual anchor linking business architecture to operational reality; contained by the L1 capability, provided by Business Applications |
| Service Operation | Digital Interface (DIM) | Owned by the provider Service Domain; Semantic APIs are the reference spec; physical APIs link at the deployed-endpoint level |

Four-layer traversal: **Conceptual** (Business Capability + Service Domain) → **Logical**
(Digital Interface / Integration) → **Physical** (Service Instance, API CIs) →
**Business Consumption** (Business Service + Offering). Bidirectional: strategy decomposes
down to deployed endpoints; an outage or CVE traces up to the capability and
customer-facing service it threatens.

## How DPF uses this

1. **Banking archetypes** (`banking-financial-services` category) seed their service
   catalogs, vocabulary, and capability maps from BIAN Business Domains and Service
   Domains rather than hand-invented lists — see
   `docs/superpowers/specs/2026-06-09-bian-banking-archetypes-design.md`.
2. **Business-capability perspective**: BIAN Business Areas/Domains project into DPF's
   `BusinessCapability` substrate as a sourced perspective
   (`packages/db/src/business-capability-perspectives.ts`), the same pattern the paper
   uses for CSDM Business Capabilities — BIAN supplies the banking vocabulary, DPF's
   capability model supplies the cross-domain bridge.
3. **Service Domain canonicality** is what makes hive-mind reuse work across banking
   installs: two community banks describe the same function with the same name.

Related repo research: `docs/Reference/framework-mapping-playlist/069-csdm-v3-framework-mapping-bian-v8.md`
(the earlier BIAN v8 ↔ CSDM v3 mapping session; the v14/CSDM-5 paper above supersedes its
version-specific details while confirming its durable mappings).
