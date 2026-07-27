---
title: "Tools And Integrations"
area: platform
order: 5
---

## Use This Doc For

- `/platform/tools`
- `/platform/tools/built-ins`
- `/platform/tools/catalog`
- `/platform/tools/catalog/sync`
- `/platform/tools/integrations`
- `/platform/tools/integrations/google-business-profile`
- `/platform/tools/integrations/google-marketing-intelligence`
- `/platform/tools/inventory`
- `/platform/tools/services`
- `/platform/services`
- `/platform/integrations`
- Address validation provider choice (Smarty vs Mapbox) — see [Address Validation Providers](address-validation-providers.md)

## Start With The Object You Are Managing

“Available,” “configured,” and “usable by this coworker now” are different
claims. Choose the surface that owns the claim:

| Surface | What it represents | It does not prove |
| --- | --- | --- |
| **Tool Marketplace / Catalog** | Known MCP and agent-tool options plus setup and grant guidance | That a service is connected or executable |
| **MCP Services** | Registered service endpoints and the tools they expose | That a particular coworker has the required grant |
| **Native Integrations** | Business-system connections on DPF's shared credential and governance substrate | That every provider operation is supported or write-enabled |
| **Built-in Tools** | First-party utilities shipped with the platform | That a specific workflow has been granted access |
| **Capability Inventory** | Runtime inventory of internal tools, MCP tools, and AI providers already registered for agents | That catalog setup or a provider account is healthy |
| **Estate Discovery** | Network collectors and the evidence they produce | That a discovered item is already governed in Portfolio |

## Read Marketplace Readiness

Select the coworker whose readiness you are evaluating before acting on a
status:

- **Ready** — the current setup, model, and grant checks found no missing
  prerequisite for that marketplace entry.
- **Needs setup** — configure the service, provider, model, or other connection
  prerequisite.
- **Needs grant** — the service can exist while the selected coworker still
  lacks one or more required grants.
- **Blocked** — a platform condition prevents readiness; inspect the displayed
  reason rather than repeating setup.

Catalog sync refreshes known tool metadata. It does not configure credentials,
activate a service, grant a coworker access, or prove runtime health.

## Connect And Verify

1. Identify whether the capability should run through an MCP service, a native
   provider integration, or a built-in tool. Do not create a second connection
   path for a provider already owned by a native integration.
2. In the catalog, review category, pricing, applicable archetype, selected
   coworker, and readiness gaps.
3. Configure the owning service or integration with the narrowest provider
   account and permissions that support the intended workflow. Only authorized
   administrators can enable services and provider connections.
4. Return to the catalog or capability inventory and verify that registration,
   setup, and coworker grant state agree.
5. Exercise a read-only preview or the smallest safe operation. Record which
   account, object scope, and freshness window the preview represents.
6. For side-effecting use, verify the coworker's grant and approval posture,
   then confirm the resulting proposal and execution evidence under Governance
   & Audit.

## Native Integration Previews

Native integration pages use customer-supplied credentials and expose
connection state such as **connected** or **error**. Their preview cards are
read-first operational evidence: for example, a finance integration may show
company, customer, invoice, balance, or payment context, while a marketing
integration may show account, audience, campaign, traffic, search, listing, or
lead context.

Before relying on a preview, confirm:

- the named provider and connected account are the intended ones;
- the credential has the required provider scopes;
- the page states whether the view is read-only;
- the displayed data has a visible or otherwise defensible freshness window;
  and
- the coverage matrix marks the required object or operation as supported.

An integration can be connected while a particular operation remains
unsupported. Capability support must be explicit; absence of an error is not
proof of support.

## Troubleshooting And Recovery

- **Catalog entry, no service** — complete setup on the owning MCP service or
  native integration page.
- **Service active, coworker not ready** — resolve the named missing grant or
  model prerequisite; do not duplicate the service.
- **Connected integration, empty preview** — verify provider account scope,
  permissions, and freshness before changing DPF authority.
- **Integration error** — repair or rotate the provider credential and retest
  the smallest read path. Preserve the error evidence needed to explain the
  outage.
- **Capability inventory empty or stale** — use the governed sync/deploy path
  that populates platform capabilities. Do not treat an empty inventory as
  proof that the tools were removed from every runtime.
- **Provider operation unsupported** — follow the explicit unsupported status
  and use a documented alternative. Do not infer write support from read
  coverage.

## What To Watch

- inventory entries that exist but are not usable from governed routes
- sync operations that refresh metadata without updating route expectations
- service activation attempts without matching documentation or trust guidance
- provider previews that show data without making account scope, freshness, or read-only status clear
- duplicate MCP and native connections for the same provider responsibility
- credentials broader than the workflow requires
- a connected badge being mistaken for coworker readiness
- missing capability flags being mistaken for silent success
- troubleshooting a provider failure by widening platform authority
