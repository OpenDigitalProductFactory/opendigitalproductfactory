# ADP MCP Server

Customer-configured MCP server for ADP payroll/HRIS integrations. Surfaces payroll data to DPF coworkers over HTTP JSON-RPC at `:8600/mcp`.

Design spec: [../../docs/superpowers/specs/2026-04-21-adp-mcp-integration-design.md](../../docs/superpowers/specs/2026-04-21-adp-mcp-integration-design.md)
Implementation plan: [../../docs/superpowers/plans/2026-04-21-adp-mcp-integration-plan.md](../../docs/superpowers/plans/2026-04-21-adp-mcp-integration-plan.md)

## Status

P0 scaffold — only `GET /health` and an empty `POST /mcp tools/list` implemented. Tool handlers land in P2.

## Architecture

- **Standalone**, not a pnpm-workspace member. Keeps the service portable for future publication to the DPF hive (P5 of the plan).
- Node 20 + `@modelcontextprotocol/sdk` + `undici` + `node:tls` for mTLS client credential exchanges to ADP.
- Customer's ADP client ID, client secret, cert PEM, and private key PEM are read from the shared portal Postgres (`IntegrationCredential` row with `provider="adp"`). Decrypted via the same `credential-crypto` key (`CREDENTIAL_ENCRYPTION_KEY`) the portal uses.

## Conduit principle

DPF never brokers the ADP relationship. The customer brings their own ADP API Central subscription, client credentials, and mTLS cert. This service is the connector code — not the business relationship. See the design spec's "Architectural Principle — DPF as Conduit" for the full argument.

## Production deployment notes

- **Outbound egress allowlist.** The service must be restricted to `*.api.adp.com` only. Enforcement is deployment-layer (Docker network policy or host firewall), not service-layer. Do not ship to prod without this constraint in place.
- **Encryption key required.** In production, `CREDENTIAL_ENCRYPTION_KEY` must be set. Without it, `credential-crypto` falls back to plaintext — acceptable only in dev.
- **Database access.** Reuses the portal's `DATABASE_URL`. Single-org-per-install does not justify a separate DB role.

## Local dev

```bash
cd services/adp
pnpm install
pnpm dev      # watch mode via tsx
```

Health probe:

```bash
curl -sf http://localhost:8600/health
# {"ok":true,"service":"adp","version":"0.1.0"}
```

## Compose wiring

Not yet wired into `docker-compose.yml`. Adding the service to compose is the explicit infra step — see plan P0.4 Step 4.
