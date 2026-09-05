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
- [Address Validation Providers](address-validation-providers.md) - Smarty vs Mapbox choice, one-active-provider rule, and setup checks.
- [WordPress (self-hosted)](wordpress-self-hosted.md) - connect a customer-owned WordPress site, publish approved drafts, and understand the DPF/WordPress ownership boundary.

## Connections

Open **Platform > Connections** to find nearby DPF installations or connect by invitation. A nearby result is only a setup suggestion: it never creates trust or shares backlog data by itself. Both installations must approve a connection before any shared demand or disposition can cross it.

The page reports whether the native Edge Node is listening for nearby installations. If discovery is not set up, paused, unhealthy, or blocked by an **Enrollment conflict**, use the Edge Nodes link to review its authority and network status. An enrollment conflict means that more than one installer-managed node claims this installation; DPF will not guess which node is authoritative. Invitation-based setup remains available when local-network discovery cannot be used.

For another installation owned by the same organization, choose **Set up this
DPF**. Automatic setup is available only when both installations advertise a
private/local HTTPS address whose certificate is trusted by the other host.
Both screens display the same six-digit code and **Shares / Stays here** summary.
Compare the digits directly, then choose **Codes match** on each installation.
A different code can mean that the connection is being intercepted: stop and
start setup again. DPF does not issue connection authority until authorized
operators on both installations confirm the match. The code authenticates this
one short-lived setup exchange; it is never a password or bearer credential.

When the second installation does not yet trust the organization's private
HTTPS authority, use **Connect your own installations** on the Connections
page. On the organization installation, choose **Create join file**, pick the
joining installation from the connected installations it already knows (or
name another one), confirm it, and the one-time file downloads at once. The
organization installation creates the file itself; no Edge node or host
script is involved. Move the `.dpfjoin` file to the joining computer within
its 30-minute lifetime. On that installation, choose **Join this installation**,
select the file, check the safe preview, and confirm. Choosing the file is the
whole step: the joining installation checks the file, generates its own key,
asks the organization installation to certify it, and keeps the result in its
own state directory. No command line, certificate copying, CA password, Edge
node, or installer rerun is required, and nothing is typed. Within a few
minutes the connection appears on both Connections pages as trusted, with no
approval to click. An automation agent can do the same through the
`issue_organization_join_file` and `import_organization_join_file` tools.

The file carries the public-root fingerprint and one-time enrollment authority;
it never carries the organization's CA private key. It works only for the named
installation, is honoured by the organization's certificate authority once, and
can be downloaded once. The joining installation refuses a tampered or expired
file, or one created for another installation, before contacting anyone. This
establishes machine trust only—it does not share backlog data. Demand sharing
is a separate, explicit choice in Delivery Flow.

If the candidate uses HTTP, its certificate cannot be verified, or discovery is
unavailable, use the invitation controls on the same page. Never bypass the TLS
warning: issue the one-time invitation on one installation and enter it with the
peer URL on the other.

Choose the relationship preset that matches the connection:

- **Same organization** for installations operated by the same company.
- **Service provider / customer** for a reseller or managed-service relationship, then select which side manages the other.

Only the minimum shared projection crosses an approved link. Local backlog detail, workrooms, private plans, attachments, and customer context remain on their originating installation. Either side can pause or revoke the connection.

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
