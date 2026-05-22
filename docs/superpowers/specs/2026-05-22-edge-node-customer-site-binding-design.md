# Edge Node Customer Site Binding Design

**Date:** 2026-05-22
**Status:** Draft
**Author:** OpenAI Codex with user direction
**Related archetype:** `it-managed-services`
**Related docs:**
- `docs/superpowers/specs/2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md`
- `docs/superpowers/plans/2026-05-22-archetype-capability-applicability-and-msp-segmentation-plan.md`
- `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`
- `docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md`
- `docs/superpowers/specs/2026-04-23-it-service-provider-msp-archetype-design.md`

## 1. Problem Statement

The MSP archetype needs Edge Nodes that can be installed inside a managed customer's environment without mixing that customer's inventory, adapter credentials, discovery runs, or operational evidence with another customer.

The platform already has `CustomerAccount`, `CustomerSite`, `CustomerConfigurationItem`, `EdgeNode`, `DiscoveryRun`, and `DiscoveryConnection`. The missing boundary is the install-time authority binding: an Edge Node should learn its customer/site scope from an authority-issued bootstrap token, then every runtime path should derive customer scope from the authenticated node record.

This is not a TeamLogic-only customization. TeamLogic IT is the first target customer informing the work, but the pattern belongs to the MSP archetype and to any future archetype that manages multiple customer estates.

## 2. Goals

- Bind bootstrap tokens to a target `CustomerAccount` and optional `CustomerSite`.
- Copy that binding onto `EdgeNode` during enrollment.
- Expose the authenticated node scope through `resolveEdgeNodeAuth`.
- Persist discovery submissions with the authenticated customer/site scope.
- Filter edge adapter credentials by authenticated node, customer account, and customer site.
- Preserve organization-scoped Edge Nodes for non-MSP and platform-local installs.
- Keep customer and site IDs out of untrusted Edge Node request bodies.

## 3. Non-Goals

- No customer-site selector UI in this first slice.
- No remote support consent workflow in this first slice.
- No migration of existing unscoped adapter rows into customer/site rows.
- No attempt to model the whole customer estate lifecycle here; the existing customer-estate and site specs remain authoritative for that layer.

## 4. Current State

`EdgeNode` currently authenticates by bearer token and exposes `edgeNodeRowId`, `nodeId`, and `trustState` to edge routes. Discovery submissions already thread `edgeNodeId` into `DiscoveryRun`, and adapter polling reads active `DiscoveryConnection` rows.

However, the current schema has no `EdgeNode.customerAccountId`, no customer/site target on `BootstrapToken`, no customer/site fields on `DiscoveryRun`, and no customer/site or target-node filter on `DiscoveryConnection`. That means a future MSP install could authenticate the node but still lack a durable customer estate boundary.

## 5. Research & Benchmarking

### 5.1 NetBox

NetBox uses tenancy to associate core infrastructure objects with owners or dependencies. Its docs explicitly call out MSPs representing each customer as a tenant, and list tenant-assignable objects such as sites, devices, prefixes, IP addresses, VLANs, circuits, clusters, and virtual machines.

Source: https://netbox.readthedocs.io/en/stable/features/tenancy/

Adopted pattern: customer ownership should be a first-class relation on infrastructure records, not a label in raw metadata.

Rejected pattern: assigning every shared object to a customer. NetBox notes that shared infrastructure may not belong to one tenant; DPF keeps organization-scoped Edge Nodes and global adapter rows for that reason.

### 5.2 NinjaOne

NinjaOne models organizations as the customer or department shell, locations as subdivisions under an organization, and devices as assigned into an organization/location. Its installer flow can deploy devices directly into the selected organization and location, and policies may apply at organization, location, or device levels.

Sources:
- https://www.ninjaone.com/docs/endpoint-management/hardware-inventory/organizations-and-locations/
- https://www.ninjaone.com/docs/policies-and-conditions/ninjaone-policies/

Adopted pattern: installation intent should carry the customer/location target so the agent lands in the correct scope at enrollment.

Rejected pattern: letting the endpoint self-assert its organization. DPF binds scope through the bootstrap token issued by the authority.

### 5.3 GLPI

GLPI entities isolate assets, users, profiles, assistance records, and permissions inside one installation. Its documentation describes entity segmentation for isolating client assets and limiting asset visibility.

Source: https://help.glpi-project.org/documentation/modules/administration/entities

Adopted pattern: customer isolation has to affect visibility and operational records, not only inventory rows.

Rejected pattern: using a single hierarchy for every type of grouping. DPF keeps `CustomerAccount`, `CustomerSite`, and Edge Node scope separate from generic tags and groups.

### 5.4 Snipe-IT

Snipe-IT supports company-scoped visibility and company-restricted locations for asset management. Its asset overview also distinguishes assets checked out to people, locations, or other assets.

Sources:
- https://snipe-it.readme.io/docs/general-settings
- https://snipe-it.readme.io/docs/overview

Adopted pattern: location matters, but location should not replace the accountable customer.

Rejected pattern: treating a location as the responsible owner. DPF requires `customerAccountId` when `customerSiteId` is set.

### 5.5 ConnectWise PSA

ConnectWise PSA configurations are company-associated records for hardware, managed services, renewals, rentals, spam statistics, and other tracked operational items. Some configurations may also carry a location/business unit filter.

Source: https://docs.connectwise.com/ConnectWise_Documentation/015/010/015/150

Adopted pattern: customer-associated configuration items should be the downstream destination for discovery and adapter evidence.

Rejected pattern: storing everything directly as PSA-style configurations. DPF keeps discovery evidence and normalized customer CIs separate so automation can improve confidence before publishing customer-facing estate records.

## 6. Target Model

### 6.1 Scope fields

Add nullable customer/site fields where scope is needed:

- `BootstrapToken.targetCustomerAccountId`
- `BootstrapToken.targetCustomerSiteId`
- `BootstrapToken.scopePolicy`
- `EdgeNode.customerAccountId`
- `EdgeNode.customerSiteId`
- `EdgeNode.scopePolicy`
- `DiscoveryRun.customerAccountId`
- `DiscoveryRun.customerSiteId`
- `DiscoveryConnection.customerAccountId`
- `DiscoveryConnection.customerSiteId`
- `DiscoveryConnection.targetEdgeNodeId`

Null customer/site scope means organization-scoped, not "unknown customer." If `customerSiteId` is present, `customerAccountId` must be present.

### 6.2 Enrollment contract

Bootstrap token issuance accepts customer/site target fields from the trusted operator/admin surface. Enrollment never accepts customer/site IDs from the Edge Node request body.

During enrollment:

1. The node presents a `dpfboot_*` bootstrap token.
2. The authority loads the bootstrap token row.
3. The authority derives normalized scope from the token's target customer/site fields.
4. The transaction creates the Edge Node with that scope.
5. The enrollment response includes the copied scope for local agent state, but server enforcement remains tied to the stored Edge Node row.

### 6.3 Runtime contract

`resolveEdgeNodeAuth` returns:

- `edgeNodeRowId`
- `nodeId`
- `trustState`
- `customerAccountId`
- `customerSiteId`
- `scopePolicy`

Routes derive tenant context from that object. Customer/site IDs in edge-submitted JSON are ignored or rejected in later slices.

### 6.4 Adapter selection

`GET /api/v1/edge/adapters` should return:

- rows targeted directly to the authenticated `targetEdgeNodeId`;
- for customer-scoped nodes, rows matching the node's customer account and exact site;
- for site-scoped nodes, account-wide rows with `customerSiteId = null`;
- for organization-scoped nodes, legacy global rows with all scope columns null.

This lets an MSP issue one adapter credential to a specific customer site, an account-wide credential to all customer sites, or a node-specific credential for exceptional cases.

## 7. Security And Governance

- The trusted boundary is bootstrap issuance, not Edge Node request data.
- Scope must be copied inside the enrollment transaction so token consumption and node creation cannot disagree.
- Adapter credential access is filtered before decryption.
- Discovery submissions persist customer/site scope from auth, not from submitted payload.
- Future remote-control work must add customer consent and operator authority checks before any remote support action can run against a scoped node.

## 8. Migration Approach

The first migration is additive:

- add nullable fields;
- add indexes;
- add foreign keys with `ON DELETE SET NULL`;
- add check constraints so site scope cannot exist without account scope;
- avoid backfilling existing rows into guessed customer/site scopes.

Existing Edge Nodes, bootstrap tokens, discovery runs, and adapter connections stay organization-scoped until an operator or migration workflow explicitly assigns scope.

## 9. UX Direction

The first UI slice should be in `/platform/edge-nodes` and customer-estate context pages:

- issue bootstrap token with optional customer and site selectors;
- show a compact scope badge for each token and node;
- show organization-scoped, customer-scoped, and site-scoped states without explanatory clutter;
- keep all colors theme-token based;
- make customer/site scope read-only after enrollment unless a governed rebind workflow exists.

## 10. Open Follow-Ups

- Customer/site selector UI for token issuance.
- Adapter management UI for customer/site/node targeting.
- Customer-estate projection from scoped discovery into `CustomerConfigurationItem`.
- Remote support consent and authority for scoped nodes.
- Policy inheritance for organization, customer account, customer site, and node.
- Operational reports by customer/site, including backup, security, endpoint, and network posture.
