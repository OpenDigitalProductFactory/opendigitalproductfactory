---
title: "Discovery Operations"
area: platform
order: 6
---

## Use This Doc For

- `/platform/tools/discovery`
- `/platform/tools/discovery/promotion-audit`

## What Discovery Does

Estate Discovery turns network observations into reviewable evidence about
devices, subnets, dependencies, and the products they may support. A discovery
result is a lead, not an authoritative inventory record. The useful outcome is
an item whose identity, purpose, ownership, taxonomy placement, and
relationships can be explained.

The page combines five views of the same operational flow:

1. **Run health** — the latest run, discovered item count, failures, and stale
   records.
2. **Connections** — the saved collectors that can be tested, rerun, edited, or
   deleted.
3. **Triage workbench** — items grouped by whether they need human review, more
   evidence, a taxonomy change, or only an audit check.
4. **Topology evidence** — subnet and dependency views, with Docker-internal
   noise hidden by default.
5. **Attributed estate** — products already connected to discovery evidence and
   ready for deeper review in Portfolio.

## Configure A Connection Safely

Only administrators with the `manage_provider_connections` capability can
enable provider services or save discovery connections. The form supports:

| Method | Supply | Best used for |
| --- | --- | --- |
| Ubiquiti UniFi | Controller URL, site, and API key | Controller-backed device and topology discovery |
| SNMP | Target host and community string | Generic network-device discovery |
| Network Scan (ARP) | IPv4 subnet in CIDR notation, `/16` through `/32` | A bounded local subnet scan |

Use **Save & Test** before relying on a connection. A successful test confirms
that the collector can currently respond and reports the devices seen by that
test; the subsequent discovery sweep pulls the fuller topology. For a saved
connection:

- **Re-test** checks reachability and credentials without treating the result as
  a new estate sweep.
- **Re-run** performs discovery and reports item and relationship counts.
- **Edit** can change the endpoint or configuration. Leaving an existing UniFi
  API-key field blank keeps the stored credential.
- **Delete** removes the saved connection after confirmation. Preserve any
  evidence or follow-up that still depends on it before deleting it.

Allow a self-signed UniFi certificate only for a controller on a trusted,
closed LAN. A TLS error is not a reason to disable validation for a public or
untrusted endpoint.

## Review A Run

1. Check when the latest run started and whether its status and failure count
   support the conclusion you are about to make.
2. Treat the **Stale** count as a warning that some displayed entities predate
   the latest run. Do not describe a stale entity as currently present without
   another current signal.
3. Review active gaps in the Triage Workbench. Compare identity confidence,
   taxonomy confidence, evidence completeness, reproducibility, first seen,
   and last seen—do not decide from one score alone.
4. Use **Request evidence** when identity is plausible but the packet is too
   thin. Use **Mark taxonomy gap** when the entity is credible but no suitable
   taxonomy node exists.
5. Accept or assign a recommendation only when the evidence explains the item
   and the proposed placement. **Dismiss** is for a finding that should leave
   the active triage queue; it is not proof that the item never existed.
6. Inspect topology in the relevant subnet scope, then open the linked product
   estate to confirm purpose, ownership, and business impact.

## Promotion And Follow-Up

Open **Promotion Audit** when discovery has produced inventory but items are not
reaching the managed portfolio. It separates:

- **discovered** items,
- items **attributed** to a taxonomy or owner context,
- items **promoted** into the managed estate, and
- items **blocked** from promotion, grouped by reason.

Resolve the recorded blocking reason rather than manually recreating the
missing product or relationship. Discovery evidence should lead to governed
portfolio records, quality issues, taxonomy review, or backlog work. It should
not become a second source of truth beside those records.

Data Enrichment is an external service, not a Discovery setting. An
administrator enables it under **Platform → Tools & Services** after finding
the service in the Tool Marketplace.

## What To Watch

- a successful connection test being mistaken for a complete, current sweep
- discovery results without identity, purpose, ownership, or blast-radius
  context
- stale entities being described as current runtime evidence
- high taxonomy confidence hiding weak identity or evidence confidence
- Docker bridges and containers obscuring the external estate view
- connection or TLS changes that widen network trust without an explicit reason
- follow-up work not being captured after triage or promotion review
