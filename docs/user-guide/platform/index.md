---
title: "Platform"
area: platform
order: 1
---

## Overview

Use the Platform area to supervise AI operations, Edge Nodes, integrations, identity, auditability, and estate-wide tooling. This section is for operators who need to understand how the platform is behaving, not just whether a single workflow succeeded.

## Route Coverage

- `/platform/ai/*` for workforce operations, routing, assignments, history, and authority
- `/platform/edge-nodes` for host-resident trust, discovery intake, and Edge Node freshness
- `/platform/federation-links` for nearby-installation discovery and approved peer connections
- `/platform/identity/*` for directory, principals, groups, and authorization posture
- `/platform/audit/*` for operational audit flows and traceability
- `/platform/tools/*`, `/platform/services/*`, and `/platform/integrations/*` for tool servers, discovery, and connector operations

## Use The Specific Guides When

- you are changing provider, routing, or assignment behavior
- you are reviewing Edge Node trust, heartbeat, or discovery intake
- you are finding a nearby DPF installation or managing a peer connection
- you are reviewing who can do what, and why
- you are validating audit coverage or governance evidence
- you are activating or troubleshooting discovery, services, or integrations

## Specific Guides

- [AI Operations](ai-operations.md) - operations map, capacity continuity, assignments, capability needs, and history.
- [Edge Nodes](edge-nodes.md) - Edge Node enrollment, trust, freshness, and host-level runbook links.
- [Tools and Integrations](tools-and-integrations.md) - tool catalog, native integrations, MCP surfaces, and service posture.

## Connections

Open **Platform > Connections** to find nearby DPF installations or connect by invitation. A nearby result is only a setup suggestion: it never creates trust or shares backlog data by itself. Both installations must approve a connection before any shared demand or disposition can cross it.

The page reports whether the native Edge Node is listening for nearby installations. If discovery is not set up, paused, or unhealthy, use the Edge Nodes link to review its authority and network status. Invitation-based setup remains available when local-network discovery cannot be used.

Choose the relationship preset that matches the connection:

- **Same organization** for installations operated by the same company.
- **Service provider / customer** for a reseller or managed-service relationship, then select which side manages the other.

Only the minimum shared projection crosses an approved link. Local backlog detail, work capsules, private plans, attachments, and customer context remain on their originating installation. Either side can pause or revoke the connection.

Classify every connection as **production**, **development**, or **test** in the
Connections table. New or unclassified links fail safely to development.
Founder Hub will not count development/test demand in its production shared
portfolio until an authorized operator explicitly promotes that origin in
Delivery Flow.

For service-provider and channel relationships, the customer controls which
outbound demand may be shared. A connection does not imply exclusivity, and
multiple partners can coexist with different scopes. Founder Hub operators can
use the reseller panel on this page to review partner standing, agreements,
entitlements, support routing, and contribution recognition without creating a
second customer identity or remote backlog.

Connection revocation stops new demand and response exchange. Item-level
withdrawal and forwarding controls live in **Operations > Delivery Flow** so
relationship administration and delivery decisions remain separate. See the
[federated demand channel runbook](../../operations/federated-demand-channels.md)
for setup, consent, troubleshooting, and recovery procedures.
