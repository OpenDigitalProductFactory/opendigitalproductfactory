# Manufacturing reference company — factory visibility contract

- **Date:** 2026-08-08
- **Status:** Proposed
- **Epic:** `EP-VERTICAL-MANUFACTURING`
- **Umbrella item:** `BI-9B4CE669`
- **Reference implementation:** `packages/storefront-templates/src/manufacturing-reference.ts`

## 1. Outcome

DPF needs one durable manufacturer that product, UX, architecture, edge, simulator, and retrieval work can all test against. The repository currently has a general demo-business generator and strong physical archetype foundations, but it has no manufacturing archetype and no realistic factory reference that connects business orders to lines, stations, equipment, telemetry, quality, and performance.

The reference is **FluxForge Motion Systems**, a fictitious high-efficiency electric-motor OEM with US engineering and validation, Mexico manufacturing, and US distribution. It is inspired by public industrial-OEM patterns, including the public Infinitum study, but it contains no real customer, employee, order, equipment, or confidential process data.

The target experience is two coordinated views in the main portal:

1. **Operations — what needs action now.** A fast plant/line/station view showing current jobs, flow, the single binding constraint, queues, quality holds, maintenance conflicts, freshness, and the next defensible decision.
2. **Performance — is the business improving.** Owner/manager measures for throughput, availability, performance, quality, schedule attainment, delivery, WIP, downtime, and energy, each with an explicit formula and evidence provenance.

This slice establishes the reference contract and golden scenarios. It does not implement the factory renderer, manufacturing execution system, or PLC/robot control.

## 2. Architecture boundary

DPF sits above and alongside the control system:

```text
Business planning / portfolio / customer promises
                    │
        DPF Performance + Operations
                    │
  manufacturing orders, quality, maintenance (future)
                    │
       trusted DPF Edge Node observations
                    │
    OPC UA / MQTT Sparkplug / vendor adapters
                    │
     SCADA / MES / PLC / robot controllers
                    │
            physical production
```

The initial industrial edge capability is **read-only**. DPF may observe and recommend; it may not write a setpoint, start or stop a line, reset an alarm, or command a robot. Future control requires the separately filed safety/authority item `BI-049F2113`, explicit activation, target-specific allowlists, authorization, interlock evidence, verified outcome, and an immutable audit trail.

### 2.1 Existing substrate we extend

- `Product`, `CatalogItem`, `ProductConfiguration`, and `CatalogSku` remain the commercial/product identity spine.
- `StockItem`, suppliers, purchase orders, and fixed assets remain their existing business authorities.
- `InventoryEntity` plus `InventoryRelationship` provide discovered internal-equipment identity and topology; time-varying observations must not be flattened into that identity record.
- `EdgeNode` provides node identity, trust, site scope, capability acceptance, heartbeat, and token/certificate lifecycle.
- `WorkQueue` / `WorkItem` can project actionable work but do not replace manufacturing job semantics.
- `DataControlOperation` is a candidate authority/reconciliation spine for future control, not permission to control equipment today.
- The existing `BomDocument` family is software/supply-chain assurance. It is explicitly **not** the manufacturing BOM.
- The spatial-twin geometry and existing `BI-E118D536` own the forthcoming `FACTORY`/`LINE` renderer.

### 2.2 New bounded contexts already filed

| Concern | Backlog item | Boundary |
|---|---|---|
| Industrial-OEM archetype and profession/coworker provisioning | `BI-7697CAD3` | archetype substrate |
| Reference corpus and regression oracle | `BI-9B4CE669` | deterministic package data |
| Manufacturing BOM revisions and routings | `BI-D5AEBEE8` | product definition |
| Production orders, operations, WIP, genealogy | `BI-17FC03D1` | manufacturing execution |
| Inspection, nonconformance, hold/release, CAPA | `BI-9CE1B61A` | quality execution |
| Equipment availability, maintenance, downtime | `BI-64B4581A` | asset operations |
| OPC UA and Sparkplug observation | `BI-B9BC5B0B` | edge ingestion |
| Factory Operations visual | `BI-E118D536` | current-state decision view |
| Manufacturing Performance view | `BI-BD94A40B` | historical/management projection |
| Future governed PLC/robot control boundary | `BI-049F2113` | consequential control |

## 3. Reference contract

The typed fixture owns these stable test inputs:

- a fictional company identity and legal notice;
- three sites and a complete ISA-95-shaped hierarchy: enterprise → site → area → line → cell → station → equipment;
- product families and make-to-stock/order/configure posture;
- ordered manufacturing stages with inputs, outputs, eligible nodes, and quality gates;
- stable equipment identity, criticality, and an explicit observe-only boundary;
- OPC UA, Sparkplug, and simulator signal mappings with semantic, source path, unit, freshness, and `writable: false`;
- a separate deterministic observation snapshot with source time, receive time, value, and quality;
- metric definitions with formula, grain, unit, source signals, and freshness;
- deterministic disruption scenarios with expected Operations decisions, Performance effects, and linked backlog evidence.

The validator rejects duplicate or dangling topology, missing equipment/signal links, writable industrial telemetry, invalid freshness windows, unordered processes, untraceable metrics, and omission of the stale-edge degradation scenario.

## 4. Operations UX target

The first viewport answers four questions without scrolling:

1. Is the evidence live and trustworthy?
2. What is the one current production constraint?
3. Which customer/order promise is affected?
4. What safe decision should the operator make next?

The factory canvas is calm 2D flow, not a decorative 3D plant. Nodes are lines/stations/equipment; edges communicate flow and blockage. Color never carries meaning alone. Freshness and source time remain visible. A lost edge connection changes running states to stale/unknown rather than preserving a misleading green condition.

Interaction targets on the reference fixture:

- cached first useful Operations paint: at most 1 second;
- line/station selection and drill response: at most 100 ms p95 locally;
- no layout jump when telemetry refreshes;
- keyboard access and an equivalent non-graph list/detail path;
- exactly one emphasized bottleneck, with other exceptions available on demand.

## 5. Performance target

Every measure is a projection with formula, grain, timezone, source, observed-at timestamp, and freshness. The initial scorecard includes:

- good-unit throughput versus plan;
- availability, performance, quality, and their OEE product;
- first-pass yield, reject, scrap, and rework;
- schedule attainment and on-time/in-full delivery;
- changeover time and WIP age;
- planned/unplanned downtime with reason Pareto;
- energy per good unit.

DPF must display incomplete evidence as incomplete. It must not calculate a plausible-looking current OEE from stale or partial counters.

## 6. Research and benchmarking

### Standards

- **ISA-95 / IEC 62264** supplies the enterprise/site/area/line/cell hierarchy, the level-3/level-4 boundary, and production request/work schedule/work request/job-order language. DPF adopts its semantic separation while allowing distributed edge transport.
- **OPC UA Devices, Machinery, Machine Tools, and ISA-95 Job Control** provide vendor-neutral equipment identity, state, job, result, and higher-level integration semantics. DPF preserves native identifiers and companion-model provenance instead of collapsing everything into ad-hoc tags.
- **MQTT Sparkplug 3.0** provides an OT-centric topic namespace, payload, and session/birth/death state. DPF uses it for stateful edge observation, never as proof that a command is safe.
- **NIST SP 800-82 Rev. 3** and **ISA/IEC 62443** require OT-specific reliability/safety treatment, least authority, segmentation, asset-owner accountability, and lifecycle security. These are why the initial adapter is read-only and site/trust scoped.
- **Asset Administration Shell (AAS)** is retained as an interoperability direction for digital nameplates, technical data, and submodel exchange. The reference shape does not claim to be a complete AAS implementation.

### Open-source leaders

- **ERPNext Manufacturing** demonstrates a legible BOM → work order → per-operation job card → workstation flow, including partial quantities, material movement, scrap, and in-process inspection. DPF adopts the separation of production order from operation execution, but adds evidence freshness, edge topology, and decision-focused Operations UX.
- **Odoo Manufacturing** demonstrates work-center capacity, alternative work centers, shop-floor execution, maintenance linkage, planning, and OEE. DPF adopts explicit capacity/availability and metric components, while rejecting an analyst-first dashboard as the primary day-of-operations surface.
- **Eclipse BaSyx** demonstrates Asset Administration Shell registries, static and dynamic submodels, protocol bridges, and device/process/product digital twins. DPF adopts typed asset identity plus live-observation separation and keeps bidirectional control off until the governed safety boundary exists.

## 7. Golden scenarios

1. **Starved assembly.** A supplier-quality hold makes a drive lot unavailable while upstream stator WIP grows. The system must preserve the hold, show the impacted order, and recommend a feasible re-sequence rather than overriding quality.
2. **Blocked end-of-line tester.** A vibration alarm blocks the lowest-capacity station with four assembled motors queued. Operations highlights one bottleneck and links maintenance/quality response; Performance shows availability and promise risk.
3. **Stale plant edge.** Observations stop for 90 seconds. The view changes equipment state to stale/unknown, retains last-observed timestamps, suppresses live recommendations, and marks current metrics incomplete.

## 8. Acceptance

- The fictional reference is exported by `@dpf/storefront-templates` and validates with zero violations.
- It covers US/MX sites, the complete plant/equipment hierarchy, process flow, equipment, telemetry, metrics, disruptions, and backlog traceability.
- All industrial signals are read-only and have freshness thresholds.
- Metrics trace to declared signals and never rely on current wall-clock time or randomness.
- The fixture can be consumed by the new archetype, demo factory, factory renderer, edge simulator, Performance projections, and corpus retrieval without importing application code into the package.
