---
title: Coordination-plane concepts
pageKind: entity
status: published
abstract: The coordination plane is the governed tool surface through which every agent — in-platform coworker, external CLI session, or federated peer — acts on the platform - MCP carries the tool contract, A2A carries agent-to-agent coordination, and both stay inside the install's private mesh by default. The plane's authority layers are strictly separated - transport identifies, authentication (FederationLink, GAID, device trust) establishes who, authorization (TAK grants) establishes what, and no layer may confer another's authority.
sources:
  - mcp/architecture
  - mcp/intro
---

## What the coordination plane is

MCP (Model Context Protocol) is a client–server protocol in which hosts connect to servers that expose tools, resources, and prompts; the platform's MCP server is the single governed door through which agents call platform capabilities. A2A surfaces extend the same posture to agent-to-agent coordination across installs. Together they form the **coordination plane**: every backlog mutation, decision consult, workroom claim, and evidence record crosses it, which is what makes it both the audit spine and the platform's most consequential integration surface.

## The layer separation

Four layers, deliberately non-interchangeable:

1. **Transport** — JSON-RPC over the supported protocol revisions; carries messages, confers nothing.
2. **Authentication** — who is calling: bearer/session credentials for clients, FederationLink + GAID + device trust for cross-install peers.
3. **Authorization** — what the caller may do: TAK grant intersection over the closed grant vocabulary; tools absent from the grant map are denied by default.
4. **Governance** — whether this call, now, is aligned: the pre-execution gate (precondition, alignment, receipts) on consequential tools.

An integration that lets one layer imply another — a trusted transport treated as authentication, a federation link treated as authorization — is the defect class this family exists to catch.

## Reachability posture

MCP and A2A are **private-mesh by default**: they serve the install's own coordination and never cross the install boundary except through the declared federation surfaces, which are `authenticated` at minimum. Endpoint classification at birth applies to every new coordination-plane surface, with the A2A cohort as the first governed set.

## Related

- [[professions/mcp-integration/mcp-protocol-version-window]] — which protocol revisions the plane speaks.
- [[professions/mcp-integration/tool-name-contract-stability]] — why tool names are a frozen contract.
- [[professions/mcp-integration/context-economy]] — the cost model for what the plane exposes per call.
