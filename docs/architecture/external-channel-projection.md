# External channel projection architecture

External channels such as WordPress are projections of governed DPF business content, not parallel systems of record. This boundary lets an internal DPF installation reach a customer-owned public channel without acquiring public hosting or inbound-network responsibilities.

## Context and allocation

A versioned DPF source passes through human approval to the provider-neutral coordinator. The coordinator reserves or reuses one current projection binding, calls the WordPress adapter over outbound HTTPS, and records an immutable publication receipt. Later observation updates drift state on the current binding.

| From | Interface | To | Durable evidence |
| --- | --- | --- | --- |
| DPF canonical source | Approved, versioned projection intent | Publication coordinator | Source reference and version |
| Publication coordinator | Reservation / binding operations | `ExternalChannelProjection` | Current remote identity and drift state |
| Publication coordinator | Provider-neutral channel request | WordPress adapter | Safe classified result |
| WordPress adapter | Outbound HTTPS REST | Customer-owned WordPress | Remote ID, URL, fingerprint, modified time |
| Publication coordinator | Append-only outcome | `OutboundPublication` | Immutable create/update receipt |

## Canonical contracts

- `ExternalChannelProjection` owns current remote identity, replay-safe duplicate prevention, lifecycle, fingerprints, and drift/ambiguity state.
- `OutboundPublication` is append-only event evidence for each completed create or update; it does not own current identity.
- `IntegrationCredential` owns connection identity and encrypted credential custody. A rotatable credential row may be audit provenance, but the stable `integrationId` is the projection connection key.
- `IntegrationImportStagedRecord` carries bounded, read-only WordPress observations. It cannot silently become canonical DPF business data.
- Channel adapters translate provider-neutral projection intent into external API calls. They do not own approval or retry policy.

## Requirements and verification

| Requirement | Allocation | Verification |
| --- | --- | --- |
| No public DPF endpoint is needed | WordPress connector uses callback kind `none` and outbound HTTPS | Connector and safe-request tests |
| One DPF source maps to at most one remote resource per kind/locale | Projection source-binding unique key | Prisma constraint and concurrent-reservation tests |
| One remote resource cannot bind to two active local projections | Remote-binding unique key | Prisma constraint and binding-conflict tests |
| Replay updates the bound remote identity | Publication coordinator supplies existing external ID | Adapter and coordinator tests |
| Uncertain writes do not auto-retry into duplicates | Ambiguous state is terminal for blind retry | Failure-path tests and operator activity view |
| Remote edits are visible without silently overwriting DPF | Fingerprint observation and drift state | Observation tests and drift UX |
| Secrets never enter views or receipts | Connector safe projection and redaction | Credential-store, connector, and UI tests |

## WordPress specialization

The WordPress adapter supports core posts, pages, and bounded media. It discovers taxonomies and custom resource types, but custom post types and plugin-specific fields remain evidence until a dedicated mapping is governed. WordPress remains authoritative for themes, layout, permalinks, plugins, hosting, CDN, and public delivery.

This is architectural parity with WordPress's content-channel role, not product parity with the WordPress CMS runtime. Additional channels should reuse the same projection, coordinator, receipt, drift, and credential contracts instead of adding provider-specific identity tables.
