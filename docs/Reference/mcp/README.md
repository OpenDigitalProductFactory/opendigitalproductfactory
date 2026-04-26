# Model Context Protocol — Reference Spec

This directory holds a snapshot of the **canonical Model Context Protocol (MCP) specification** so every DPF MCP implementation has a single, version-pinned source of truth in-tree.

| Field | Value |
| ----- | ----- |
| **Spec version** | `2025-11-25` (latest stable as of fetch) |
| **Upstream repo** | [github.com/modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol) |
| **Upstream rendered docs** | [modelcontextprotocol.io/specification/2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) |
| **License** | Apache-2.0 (specifications); see [LICENSE](./LICENSE) for the full transition note |
| **Fetched** | 2026-04-25 |
| **Maintenance** | Refresh when DPF MCP work targets a new spec version. See [ATTRIBUTION.md](./ATTRIBUTION.md) for the refresh procedure. |

## What's here

```
docs/Reference/mcp/
├── README.md            ← you are here
├── ATTRIBUTION.md       ← upstream provenance + refresh procedure
├── LICENSE              ← upstream Apache-2.0 / MIT transition notice
├── spec/                ← all .mdx files from docs/specification/2025-11-25
│   ├── index.mdx
│   ├── architecture/
│   ├── basic/           ← lifecycle, transports, authorization, utilities
│   ├── client/          ← sampling, elicitation, roots
│   └── server/          ← tools, resources, prompts, utilities
└── schema/              ← formal protocol schema
    ├── schema.json      ← JSON Schema (machine-readable)
    ├── schema.ts        ← TypeScript types (canonical reference)
    └── schema.mdx       ← schema overview/index page
```

## Read order for DPF MCP work

For anyone implementing or reviewing an MCP server / client / tool inside DPF:

1. **[spec/index.mdx](./spec/index.mdx)** — high-level overview, what MCP is, how messages flow.
2. **[spec/architecture/index.mdx](./spec/architecture/index.mdx)** — clients, servers, capabilities, the negotiation model.
3. **[spec/basic/lifecycle.mdx](./spec/basic/lifecycle.mdx)** — `initialize` / `notifications/initialized`, capability exchange. **The mandatory handshake** every server must implement.
4. **[spec/basic/transports.mdx](./spec/basic/transports.mdx)** — stdio + Streamable HTTP. DPF uses Streamable HTTP for the external endpoint.
5. **[spec/basic/authorization.mdx](./spec/basic/authorization.mdx)** — OAuth 2.1, bearer tokens, the resource-server vs authorization-server split. Read before designing any auth model around an MCP endpoint.
6. **[spec/basic/index.mdx](./spec/basic/index.mdx)** — JSON-RPC envelope, error codes, request/response/notification types.
7. **[spec/server/tools.mdx](./spec/server/tools.mdx)** — `tools/list`, `tools/call`, schema shape, annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). **The DPF default surface.**
8. **[schema/schema.ts](./schema/schema.ts)** — when in doubt about a field name or required-ness, this is the authority.

Server-side utilities likely to matter for DPF:

- [spec/server/utilities/pagination.mdx](./spec/server/utilities/pagination.mdx) — for `tools/list` cursors when the surface grows.
- [spec/server/utilities/logging.mdx](./spec/server/utilities/logging.mdx) — `notifications/message` for streaming progress back.
- [spec/basic/utilities/progress.mdx](./spec/basic/utilities/progress.mdx) — long-running tool calls.
- [spec/basic/utilities/cancellation.mdx](./spec/basic/utilities/cancellation.mdx) — when the client gives up early.

Client-side features (resources, prompts, sampling, elicitation, roots) are **not currently planned for DPF's MCP server**, but the docs are here for completeness so we can decide deliberately rather than by omission if the question comes up.

## Why a local copy

- **Reviewable diffs.** When we bump the spec version, a single PR shows exactly what changed in the protocol, which lets us audit our implementation against the delta.
- **Version pinning.** A DPF MCP implementation cites a specific spec version. The local copy is the contract we built against.
- **Offline / build-time.** Anything generated from the JSON Schema (validators, types, mock servers) reads from `schema/schema.json` here, not the network.
- **Stable links.** Spec docs in spec/plan files reference paths under this directory — those won't 404 if the upstream site reorganises.

## How to refresh

See [ATTRIBUTION.md](./ATTRIBUTION.md) — single command + a checklist for verifying nothing in our implementation drifted past what the new version permits.
