---
title: Model what naturally happens — don't build a data lake
pageKind: heuristic
status: published
abstract: A canonical data model that connects the relationships that already exist beats a federated data lake that aggregates everything centrally.
sources:
  - frameworks/csdm
---

## The heuristic

> When scoping a cross-domain platform, **model the relationships that already exist** between asset, dev, ops, ITSM, and CSM. Don&#39;t aggregate data into a central lake just because you can.

## When it applies

Designing `[[entities/csdm]]`-style data foundations. Standing up a CMDB. Scoping a discovery / inventory platform. Any cross-domain data architecture where the temptation is "let&#39;s put it all in one place."

## Why it works

The mistake people make with cross-domain data is assuming the value is in *centralising* it. The actual value is in *connecting* it. Asset, Dev, Ops, ITSM, and CSM already have data — the gap is that they don&#39;t agree on which row means what. A canonical model that names the entities and the relationships gets you the cross-domain insight without paying the centralisation cost.

The CSDM origin story is exactly this lesson: the early technical-debt reporting work needed a single source of truth, but trying to aggregate the data centrally was both expensive and politically intractable. **The vision was to create a common model that connects what naturally happens. CSDM was born.**

## Counterexamples

- Analytics workloads where you genuinely do need physically co-located data (e.g., joins at scale across hundreds of millions of rows). Build the lake for those; keep the canonical model for the cross-domain agreement.
- Compliance audit scenarios where regulators require a single authoritative store.
- Real-time joins that can&#39;t tolerate the latency of distributed sources.

## See also

- Parent stance: `[[stances/trust-the-cmdb-or-rebuild-it]]`
- Related heuristic: `[[heuristics/auto-populate-or-its-wrong]]`
- Entity: `[[entities/csdm]]`
