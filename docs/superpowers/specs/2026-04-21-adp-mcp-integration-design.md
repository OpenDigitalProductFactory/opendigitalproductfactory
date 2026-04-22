# ADP MCP Integration Design

**Date:** 2026-04-21
**Status:** Draft — pending review
**Epic:** EP-ADP-001 (proposed)
**Scope:** Introduce an ADP payroll/HRIS MCP server as a customer-configured integration, owned by a new Payroll Specialist coworker. Phase 1 is read-only workers, pay statements, time cards, and deductions. Writes are deferred to Phase 2.

---

## Problem Statement

DPF today has an HR workforce core (`EmployeeProfile`, `Department`, `Position`, `EmploymentEvent`, etc.) seeded at install but no link to an authoritative payroll system of record. Customers with an existing ADP Workforce Now, RUN, or Vantage HCM subscription want their AI coworkers to answer questions about real payroll data ("how many hours did engineering log last period?", "show me Jane's last three pay statements") and, eventually, to initiate payroll actions under human approval.

The 2026-03-13 HR Workforce Core spec explicitly deferred payroll, benefits, and attendance. This spec picks that up for customers who already use ADP.

## Goals

1. Let a customer connect their existing ADP API Central account to their DPF install without any involvement from DPF as a business entity.
2. Surface ADP data to coworkers through a dedicated MCP server, not through in-portal imports.
3. Introduce a dedicated Payroll Specialist coworker that owns the payroll skill surface. (The existing HR Specialist persona at `prompts/route-persona/hr-specialist.prompt.md` remains role/accountability focused; payroll is a distinct domain.)
4. Keep the door open to future ADP partner enrollment without reworking the customer-facing UX.
5. Strict proposal-mode gating for any write tool — payroll writes never auto-approve.
6. Treat payroll data as the most sensitive data in the platform: encrypted at rest, redacted in LLM context, fully audited.

## Non-Goals

- **DPF enrollment in the ADP Partner Program.** Explicitly out of scope for this phase. Revisit when the customer base and ops capacity justify the MNDA/LOI/sandbox-agreement overhead.
- **Multi-tenant credential brokering.** DPF is single-org-per-install; each install holds exactly one customer's ADP credentials.
- **Screen-scrape or browser-automation fallbacks** against the ADP web UI. MCP calls go through the official REST API only.
- **Replacing `EmployeeProfile` with ADP worker records.** The HR workforce core remains authoritative for DPF-internal structure. ADP is the system of record for employment terms and pay; DPF records map by external ID.
- **Multi-country payroll, tax filing, or benefits enrollment writes** in Phase 1 or 2. Separate scope.
- **Tools that return raw SSN, bank routing, or full DOB to the LLM context.** Redacted-only.

---

## Architectural Principle — DPF as Conduit

From the 2026-04-21 decision: DPF never brokers the vendor relationship for enterprise integrations. Each install's customer maintains their own ADP API Central subscription, their own Partner Self-Service Portal account, their own client ID and secret, and their own mTLS cert pair. DPF provides only the connector code, the encrypted storage, and the "Connect to ADP" UX. This applies to ADP today and establishes the pattern for future HRIS, ERP, and banking integrations.

**Future-partner path (non-blocking):** If DPF later enrolls as an ADP Marketplace partner, the same `IntegrationCredential` model and MCP server can accept a platform-scoped OAuth application instead of customer-scoped client credentials. The user-facing "Connect to ADP" flow stays the same — the difference is whether the customer's API Central app or DPF's partner app holds the OAuth client identity.

---

## Design

### 1. Credential Model — `IntegrationCredential`

Introduce a polymorphic credential model alongside the existing `CredentialEntry` (which stays OAuth-shaped for LLM providers).

```prisma
model IntegrationCredential {
  id             String    @id @default(cuid())
  integrationId  String    @unique            // e.g. "adp-workforce-now", "quickbooks-online"
  provider       String                       // "adp", "quickbooks", "plaid", …
  status         String    @default("unconfigured") // unconfigured | connected | error | expired
  fieldsEnc      String    @db.Text           // AES-256-GCM ciphertext of JSON { clientId, clientSecret, certPem, privateKeyPem, subscriptionKey?, … }
  tokenCacheEnc  String?   @db.Text           // AES-256-GCM ciphertext of JSON { accessToken, expiresAt }
  lastTestedAt   DateTime?
  lastErrorAt    DateTime?
  lastErrorMsg   String?                      // redacted — never include secret material
  certExpiresAt  DateTime?                    // surfaced for expiry warnings
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([provider, status])
}
```

- **Encryption:** reuses [apps/web/lib/govern/credential-crypto.ts](apps/web/lib/govern/credential-crypto.ts). Today's module exports `encryptSecret(plaintext: string)` / `decryptSecret(stored: string)` that round-trip strings. Phase P0 adds thin `encryptJson<T>(value: T): string` / `decryptJson<T>(stored: string): T | null` helpers that `JSON.stringify` before calling `encryptSecret` and `JSON.parse` after `decryptSecret`. `fieldsEnc` and `tokenCacheEnc` are produced by `encryptJson`. Per-field columns are avoided so the same model absorbs future integrations (QuickBooks, Plaid, Workday) with different credential shapes.
- **Token cache:** access tokens from client_credentials exchanges are cached until expiry-minus-60s. Never persist raw tokens in logs or audit rows.
- **Cert expiry:** `certExpiresAt` is parsed from the cert PEM at save time and drives a 60-day-ahead dashboard warning for the HR admin (mirrors ADP's own expiry notification window).

### 2. "Connect to ADP" UX

Route: `/settings/integrations/adp` (also reachable from an HR Specialist coworker CTA: "I need ADP access to answer that — set it up here.").

**Field set (single form, OAuth-style polish):**

| Field | Source (in customer's ADP Partner Self-Service Portal) | Storage |
|---|---|---|
| Client ID | Apps → Your App → Credentials | `fieldsEnc.clientId` |
| Client Secret | Apps → Your App → Credentials (reveal once) | `fieldsEnc.clientSecret` |
| Certificate (PEM) | Certificates → Download public cert | `fieldsEnc.certPem` |
| Private Key (PEM) | Certificates → Key generated at CSR time | `fieldsEnc.privateKeyPem` |
| Environment | `sandbox` / `production` radio | `fieldsEnc.environment` |

**Flow:**
1. Admin lands on panel, sees "Not connected" + instructions linking to ADP's Partner Self-Service docs.
2. Admin pastes fields, clicks **Connect**.
3. Server-side: write to `IntegrationCredential` (encrypted), then run a test exchange — `POST https://{env}.api.adp.com/auth/oauth/v2/token` with `grant_type=client_credentials` over an mTLS socket using the cert + key. On success, store access token to `tokenCacheEnc`, set `status=connected`, render "Connected ✓ — cert expires 2027-04-21".
4. On failure, surface a redacted error (e.g. "mTLS handshake failed — verify cert matches the one registered in ADP Partner Self-Service") and leave `status=error`.

**Cert parse failure is fail-closed.** If the submitted PEM can't be parsed to extract `notAfter` for `certExpiresAt`, the Connect flow rejects the submission with a redacted "certificate unreadable — check the PEM you pasted" message and does **not** persist the credential. An unparseable cert never reaches the "Connected ✓" state and never survives to the next request.

The UX looks and feels like an OAuth connect flow even though the underlying grant is `client_credentials` + mTLS. The admin never pastes a token and never handles bearer headers.

### 3. MCP Server — `services/adp/`

New Docker Compose service, mirroring the `services/browser-use/` pattern.

- **Stack:** Node.js 20 + `@modelcontextprotocol/sdk` (TypeScript) + `node:tls` for mTLS + `undici` for HTTP.
- **Transport:** HTTP JSON-RPC at `http://adp:8600/mcp`, same shape as browser-use.
- **Startup dependency:** portal `depends_on` waits for adp service health.
- **Config:** mounts the portal's encryption key via env (`CREDENTIAL_ENCRYPTION_KEY`) and reads `IntegrationCredential` from the shared database at call time. It does not hold creds in memory across calls.
- **Database access:** the `adp` service reuses the same `DATABASE_URL` the portal and `portal-init` use (passed through compose). This matches the existing pattern for in-stack services that share the single-org Postgres. No separate role — single-org-per-install does not justify a dedicated DB user.
- **Outbound allowlist:** the adp service's egress is restricted to `*.api.adp.com`.

### 4. Tools — Phase 1 (read-only)

All tools are registered via the existing MCP surface and assigned to the HR Specialist coworker only.

| Tool | Purpose | ADP Endpoint |
|---|---|---|
| `adp_list_workers` | List active workers; returns `{ workerId, displayName, employeeNumber, positionTitle, departmentCode, hireDate, status }`. SSN redacted to last-4. | `GET /hr/v2/workers` |
| `adp_get_pay_statements` | Paginated pay statements for a worker within a date range; returns gross, net, earnings[], deductions[], taxes[]. Bank routing redacted. | `GET /payroll/v1/workers/{aoid}/pay-statements` |
| `adp_get_time_cards` | Time cards for a worker or position within a pay period. | `GET /time/v2/workers/{aoid}/time-cards` |
| `adp_get_deductions` | Recurring deduction configuration per worker (benefits, garnishments). Account numbers redacted. | `GET /payroll/v1/workers/{aoid}/deductions` |

Each tool:
- Validates inputs (worker ID regex, date-range bounds, pagination cursor opaque pass-through).
- Runs through a PII redaction layer before returning to the MCP caller.
- Writes one row to `IntegrationToolCallLog` per call (with `integration="adp"`).
- Attaches `[tool-trace]` structured log lines per the durable-logging pattern.

### 5. Tools — Phase 2 (writes, always proposal-mode)

Deferred to a follow-up PR, but the contract is declared now so the schema and grants land once:

| Tool | Purpose | ADP Endpoint | Execution |
|---|---|---|---|
| `adp_submit_pay_data_batch` | Append earnings, deductions, reimbursements to a payroll cycle. | `POST /payroll/v1/pay-data-input` | `executionMode: "proposal"`, `autoApproveWhen: null` |
| `adp_modify_deductions` | Add/update worker deductions. | `POST /payroll/v1/workers/{aoid}/deductions` | `proposal`, no auto-approve |
| `adp_add_time_entries` | Upload time entries for employee positions. | `POST /time/v2/workers/{aoid}/time-entries` | `proposal`, no auto-approve |

`autoApproveWhen: null` is mandatory — see the 2026-04-19 memory on proposal-mode silent failures. Payroll writes always pause for a human.

### 6. Payroll Specialist Coworker

New coworker seeded via `.prompt.md` files. **Not** a modification of the existing `hr-specialist.prompt.md` (HR Director persona, scoped to roles/accountability/HITL) — payroll is a distinct domain.

- **Prompt path:** `prompts/route-persona/payroll-specialist.prompt.md` (persona), `prompts/specialist/payroll-specialist-adp.prompt.md` (skill-level guidance for ADP specifically).
- **Skills:** payroll-inquiry, time-and-attendance-inquiry, deductions-inquiry. Phase 2 adds pay-data-submission and deduction-edit under proposal mode.
- **Tool grants:** the four Phase 1 tools granted at coworker creation. Grants added via the invariant guard (`project_agent_grant_seeding_gap` memory — guard prevents silent denies).
- **Surface:** available on `/people` and `/finance` routes. Settings CTA on `/settings/integrations/adp` to "Talk to the Payroll Specialist" once connected.

Finance remains GL/reporting focused; HR Specialist stays role/accountability focused; Payroll Specialist owns worker pay data, time, pay statements, and the ADP relationship. First coworker in a future HRIS / benefits / T&A family that can reuse this integration skeleton.

### 7. PII Redaction Layer

A single module at `apps/web/lib/integrate/adp/redact.ts` runs over every MCP tool response before the LLM sees it.

Rules:
- `ssn`, `taxId`, `governmentId` → `"xxx-xx-####"` (last 4 preserved for human disambiguation).
- `bankAccountNumber`, `routingNumber`, `accountNumber` → `"****####"`.
- `dateOfBirth` → year-only (`"1984"`).
- Free-text fields (`note`, `comment`, `description`) → pass through a prompt-injection heuristic that strips known jailbreak patterns and flags suspicious content to the audit log without blocking.

The redaction layer is tested with a fixture corpus before every deploy. The LLM never sees unredacted data; the human UI in the portal may render fuller data under role-gated access (not this spec's scope).

### 8. Audit Log — `IntegrationToolCallLog`

Generalized model so the second enterprise integration (QuickBooks, Workday, etc.) can reuse it. Not ADP-specific.

```prisma
model IntegrationToolCallLog {
  id            String   @id @default(cuid())
  calledAt      DateTime @default(now())
  integration   String                          // "adp", "quickbooks", "plaid", …
  coworkerId    String                          // which coworker invoked
  userId        String?                         // human who initiated the conversation
  toolName      String                          // "adp_list_workers", "qb_list_invoices", …
  argsHash      String                          // sha256 of canonicalized args — not raw args
  responseKind  String                          // "success" | "error" | "rate-limited"
  resultCount   Int?                            // list/paginated cardinality
  durationMs    Int
  errorCode     String?
  errorMessage  String?                         // redacted — never includes secret material

  @@index([calledAt])
  @@index([integration, calledAt])
  @@index([coworkerId, calledAt])
  @@index([toolName, calledAt])
}
```

Distinct from existing audit tables by design: `ComplianceAuditLog` is entity-diff focused (not tool-call), `AgentActionProposal` covers write proposals (not reads). `IntegrationToolCallLog` is the call-level record for every enterprise-integration MCP invocation.

Payload bodies are not stored — hashed args suffice for compliance replay. An admin view at `/admin/integrations/audit` surfaces recent activity, filterable by `integration`.

### 9. Data Flow

```
HR Admin ─► /settings/integrations/adp (paste creds)
         ─► POST /api/integrations/adp/connect
                ├─ encryptSecret(fields) → IntegrationCredential.fieldsEnc
                └─ test client_credentials + mTLS exchange
                    ├─ success → status=connected, tokenCacheEnc set
                    └─ fail    → status=error, redacted message

Coworker call ─► HR Specialist (LLM) decides to call adp_list_workers
         ─► portal MCP client → http://adp:8600/mcp tools/call
                ├─ adp service loads IntegrationCredential
                ├─ refresh token if expired (client_credentials + mTLS)
                ├─ GET https://api.adp.com/hr/v2/workers  (mTLS socket, Bearer token)
                ├─ redact() response
                ├─ IntegrationToolCallLog.create({ integration: "adp", ... })
                └─ return JSON-RPC result
         ─► redacted payload flows into LLM context
         ─► coworker answers user
```

### 10. Mapping to DPF Workforce Core

- `EmployeeProfile.externalIds` (existing or to be added) grows an `adpAoid` key to link a DPF-internal employee to the ADP worker record.
- No automatic sync. Phase 1 reads ADP on demand; mapping is established when the HR Specialist is asked about an employee already in `EmployeeProfile` — the coworker queries `adp_list_workers` filtered by name/employee-number and writes the mapping to `EmployeeProfile.externalIds.adpAoid` after human confirmation.
- Reverse-sync (pushing DPF employees to ADP) is out of scope; ADP remains the source of truth for who's actually on payroll.

---

## Security (CoSAI summary — see 2026-04-21 evaluation for full matrix)

| Concern | Treatment |
|---|---|
| Auth | OAuth 2.0 `client_credentials` over mTLS. mTLS enforced at `node:tls` socket level. |
| Credential storage | AES-256-GCM via existing `credential-crypto.ts`. Key required in prod (`CREDENTIAL_ENCRYPTION_KEY`). |
| PII in LLM context | Mandatory redaction layer; LLM sees masked values only. |
| Prompt injection via payroll narrative fields | Free-text sanitized; suspicious patterns logged to audit but not blocked. |
| Write-tool confused-deputy risk | All writes `executionMode: "proposal"` with `autoApproveWhen: null`. Human approval required every time. |
| Network isolation | Dedicated `services/adp/` container; egress limited to `*.api.adp.com`. |
| Rate limiting | Timeout + paginated reads; exponential backoff on 429. |
| Audit | `IntegrationToolCallLog` row per tool call; hashed args, redacted errors. |
| Supply chain | No `adp-api` or `adp-connection` npm deps. Thin hand-written client over `node:tls` + `undici`. |

---

## Implementation Plan

Phased to keep the first PR small and to land the prerequisite infrastructure once.

| Phase | Scope | Blocking? |
|---|---|---|
| **P0 — Foundation** | `IntegrationCredential` model + migration; add `encryptJson`/`decryptJson` helpers to `credential-crypto.ts`; `services/adp/` skeleton container with `DATABASE_URL` passthrough; health check; compose wiring. | Blocks P1 |
| **P1 — Connect flow** | Settings panel UI; `/api/integrations/adp/connect`; test-exchange against ADP sandbox; cert expiry parsing with fail-closed reject on unparseable PEM. | Blocks P2 |
| **P2 — Read tools** | 4 MCP tools; PII redaction module with fixture tests; `IntegrationToolCallLog` model + admin view at `/admin/integrations/audit`. | Blocks P3 |
| **P3 — Payroll Specialist coworker** | Prompt files seeded at `prompts/route-persona/payroll-specialist.prompt.md`; skill definitions; tool grants with invariant guard; route surface on `/people`. | Ship Phase 1 |
| **P4 — Writes (Phase 2)** | 3 write tools under proposal mode; approval UI lives in existing proposal surface. | Separate spec/PR |
| **P5 — Hive publication** | Package `services/adp/` for publication to the hive as an open-source MCP. | Separate spec/PR |

Shipping target for P0–P3 (Phase 1): single epic, target ~2 weeks of work, done through Build Studio.

---

## Open Questions

1. **ADP rate limits** — not publicly documented. Plan to discover empirically in sandbox and encode backoff. Acceptable?
2. **Cert rotation UX** — ADP auto-signs new certs; the admin downloads replacement PEMs and re-pastes into DPF. Should we offer a "cert rotation reminder" email at T-60 days in addition to the dashboard warning?
3. **Multi-cycle pay statement pagination** — ADP caps responses. Do we surface a cursor to the coworker, or transparently paginate inside the tool and return a merged window?
4. **Phase 2 approval routing** — which human(s) approve payroll writes? HR admin? Finance? Both? (This is governance, not MCP — resolve before starting P4.)

---

## Re-evaluation Triggers

- ADP ships an official MCP server → reconsider adopting theirs in place of the hand-built connector.
- `@modelcontextprotocol/sdk` major version bumps → recheck MCP transport assumptions.
- DPF decides to enroll as ADP Marketplace partner → re-scope UX (consent flow vs paste fields).
- Second enterprise integration target chosen (QuickBooks, Workday, etc.) → validate that `IntegrationCredential` polymorphism holds.

---

## References

- [2026-03-13 HR Workforce Core Design](./2026-03-13-hr-workforce-core-design.md) — the workforce domain this spec layers on.
- [2026-03-16 External Services & MCP Surface Design](./2026-03-16-external-services-mcp-surface-design.md) — superseded, but informs MCP surface treatment.
- [2026-03-20 MCP Activation and Services Surface Design](./2026-03-20-mcp-activation-and-services-surface-design.md) — active MCP surface pattern.
- [2026-04-06 Browser-Use Integration Design](./2026-04-06-browser-use-integration-design.md) — architectural template for the `services/adp/` container.
- [apps/web/lib/govern/credential-crypto.ts](../../../apps/web/lib/govern/credential-crypto.ts) — reused encryption primitives.
- [ADP Developer Portal — Getting Started as a Partner](https://developers.adp.com/getting-started/getting-started-as-a-partner/guides/adp-marketplace-integration-guides/partner-development-learning-guide) — customer-side setup reference.
- [ADP Workers v2 API Explorer](https://developers.adp.com/build/api-explorer/hcm-offrg-wfn/hcm-offrg-wfn-hr-workers-v2-workers) — endpoint reference.
