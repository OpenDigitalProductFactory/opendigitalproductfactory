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

For another installation owned by the same organization, choose **Set up this
DPF**. Automatic setup is available only when both installations advertise a
private/local HTTPS address whose certificate is trusted by the other host.
Confirm that both screens show the same matching code and the same **Shares / Stays
here** summary, then approve on the receiving installation. DPF exchanges and
redeems a short-lived invitation, but the resulting connection remains pending
until an authorized operator independently approves the connection on both
installations. The matching code is only a visual check; it is never a password
or bearer credential.

When the second installation does not yet trust the organization's private
HTTPS authority, DPF support can create a private `.dpfjoin` file for that one
installation. Move the file to the joining computer within 15 minutes and let
the DPF installer apply it. The file carries the public-root fingerprint and a
one-time enrollment authority; it never carries the organization's CA private
key. It works only for the named installation and is removed after successful
use. This establishes certificate trust only—the two Connections screens still
show the matching code and still require independent approval before any demand
is shared.

The installer owns the technical work. On macOS/Linux it accepts the file as
the **organization join package** input; the Windows installer accepts the same
`.dpfjoin` file. After validation, DPF obtains the local HTTPS certificate,
stores the public organization root, configures the HTTPS endpoint, and remembers
that trust on later starts. A joining installation does not run or receive the
organization CA. Until the Connections file picker is enabled, support may need
to supply this installer input during setup; operators should never extract the
file or copy certificates and environment settings by hand.

If the candidate uses HTTP, its certificate cannot be verified, or discovery is
unavailable, use the invitation controls on the same page. Never bypass the TLS
warning: issue the one-time invitation on one installation and enter it with the
peer URL on the other.

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
