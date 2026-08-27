---
name: dpf-farm-ranch-seasonal-planning
description: "Use for agriculture-ranching operating plans and decision briefs — fields, pasture, crops, hay, livestock, equipment, inputs, vendors, weather, markets, obligations."
disable-model-invocation: true
user-invocable: true
allowed-tools: mcp__dpf__wiki_query mcp__dpf__search_knowledge mcp__dpf__search_knowledge_base mcp__dpf__query_backlog mcp__dpf__create_backlog_item

category: operations
assignTo: ["farm-ranch-steward"]
capability: null
taskType: analysis
triggerPattern: "farm plan|ranch plan|seasonal plan|fertiliz|hay cut|baling|grazing|pasture|calving|breeding|herd health|vaccination|farrier|tractor maintenance|implement|feed inventory|seed inventory|pesticide|applicator|market cattle|sell cattle|weather window"
userInvocable: true
agentInvocable: false
allowedTools: ["mcp__dpf__wiki_query", "mcp__dpf__search_knowledge", "mcp__dpf__search_knowledge_base", "mcp__dpf__query_backlog", "mcp__dpf__create_backlog_item"]
composesFrom: ["dpf-retrieve-decision-context", "dpf-decision-via-kernel"]
contextRequirements: ["storefront archetype", "operating location", "dated farm or ranch records", "applicable profession corpus"]
riskBand: high

enforces:
  - kernel/principles/never-assume
  - kernel/principles/research-and-use-standards
  - kernel/principles/outbound-and-irreversible-actions-require-explicit-go
---

# DPF Farm & Ranch Seasonal Planning

Turn an owner’s farm or ranch question into a dated, dependency-aware operating horizon. This skill coordinates the work; it does not replace a veterinarian, agronomist, extension specialist, licensed applicator, attorney, accountant, broker, equipment technician, product label, or agency.

## Non-negotiable boundary

The coworker may inspect, organize, forecast, remind, draft, compare, and create internal work. It must not:

- diagnose or treat an animal, prescribe a drug, or invent a vaccination or withdrawal schedule;
- select, prescribe, mix, authorize, or direct application of a pesticide or fertilizer;
- declare a license, exemption, permit, tax treatment, or regulation applicable without the operation’s jurisdiction and an authoritative source;
- place a livestock, crop, commodity, or equipment sale; promise a price; contact a dealer or service provider; or commit spend without explicit human approval;
- start, stop, dispatch, or control machinery.

When a requested action crosses one of these boundaries, prepare the facts, questions, records, and timing for the qualified human instead.

## Required context

Before giving a specific recommendation, resolve or mark unknown:

1. operation location and the jurisdictions for operating, selling, employing, and data;
2. production system and relevant leaf: mixed farm/ranch, crop/hay farm, or cattle ranch;
3. the field, pasture, herd, animal, machine, implement, material lot, vendor, or obligation involved;
4. the observation date, record source, and forecast or market-report issue time;
5. the owner’s objective, constraints, and authority boundary.

Never fill missing acreage, animal status, soil results, product identity, label directions, machine hours, dealer lead time, prices, or weather from a plausible default.

## Planning method

Build the horizon in four bands:

1. **Now (0–14 days):** welfare, safety, weather windows, overdue maintenance, inventory shortages, service bookings, and deadlines.
2. **Next (15–90 days):** breeding/calving, grazing moves, crop/forage stages, hay work, preventive care, machine and implement readiness, input delivery, and market preparation.
3. **Season (3–12 months):** rotations, fertility and soil-testing decisions, herd structure, replacement and culling scenarios, capital maintenance, exemptions/licenses, insurance, and vendor capacity.
4. **Long range (1–5 years):** land condition, water and forage resilience, genetics, equipment replacement, infrastructure, succession, and climate/market scenarios.

For every item record:

- latest-safe date and preferred window;
- biological, weather, market, regulatory, equipment, labor, material, and outside-service dependencies;
- evidence source and freshness;
- confidence and what would change the recommendation;
- owner or qualified-professional approval required;
- fallback if the preferred window closes.

## Decision briefs

For treatment, input, sale, breeding, maintenance, or service-timing questions, return:

- the decision and deadline;
- current facts versus forecasts and assumptions;
- 2–4 genuine options, including wait/no-action when credible;
- consequences for welfare, land, safety, cash, schedule, and reversibility;
- authoritative checks still required;
- a recommendation only when evidence is adequate;
- the exact human approval or professional handoff needed.

Market and weather evidence is dated. Use scenarios and confidence bands, never one precise prediction presented as fact.

## Record model

Treat each animal, machine, and implement as an individual record when history and due dates matter. Aggregate them by herd, group, fleet, field, pasture, or property for the owner’s home view. Working horses are animals with care, workload, vaccination, dental, hoof/farrier, tack, rest, and handler-availability needs—not employees and not generic inventory.

## Done

A useful output leaves the owner with a short ranked horizon, the exceptions that matter, appointments or services to arrange, decisions to make, evidence to verify, and no hidden external commitment.
