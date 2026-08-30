# Optional runtime-secret provider design

**Status:** proposed for independent review  
**Backlog:** BI-E7553A1C  
**Epic:** EP-413F2602  
**Decision:** DI-CB9275DCC886—optional provider adapter, high confidence

## 1. Problem

Deployment contract §8 says the same logical secrets may be backed by `.env`, cloud secret managers, Kubernetes Secrets, or a managed platform store. The runtime implements only the first form for its two most consequential application secrets: `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`. This turns a portability doctrine into an unimplemented promise and keeps high-value material durably beside the install.

The integration must not confuse secret custody with identity or authority. DPF already owns principals, authentication policy, LDAP, Step CA PKI, authorization, connector credential lifecycle, and audit. 1Password may provide bytes at startup; it may not decide what those bytes mean.

## 2. Objectives

**OBJ-RSP-001:** Establish one provider-neutral, pre-migration startup boundary for logical runtime secrets while preserving the environment provider as the default.

**OBJ-RSP-002:** Add an optional 1Password Connect adapter that fetches one explicitly configured item once per portal start using least privilege and value-free failures.

**OBJ-RSP-003:** Preserve DPF as the sole authority for identity, LDAP, PKI, authorization, connector credential lifecycle, redaction, and platform audit.

**OBJ-RSP-004:** Keep provider semantics portable so future cloud-manager, Kubernetes, OpenBao, or Vault adapters require no changes in application consumers.

**OBJ-RSP-005:** Give operators truthful setup, outage, recovery, rollback, audit, and threat-boundary guidance.

## 3. Research and benchmarking

The tool evaluation at `docs/security/tool-evaluations/2026-08-30-1password.md` compares 1Password Connect, service accounts, HashiCorp Vault, OpenBao, and Infisical against NIST SP 800-57, NIST SP 800-63B-4, and OWASP secrets-management guidance.

DPF adopts the common architecture: central custody, a narrowly scoped workload token, startup-only resolution, explicit failure, independent audit, and provider portability. It rejects Vault-like dynamic-secret semantics in this slice, rejects a version-0 1Password SDK dependency, and rejects moving connector credentials out of DPF.

## 4. Architecture

```text
deployment wrapper
  ├─ environment provider (default; current behavior)
  └─ onepassword-connect provider (optional)
       ├─ private Connect URL
       ├─ dedicated-vault bearer token (file preferred)
       └─ one vault id + one item id
                    │ fetch once, bounded timeout
                    ▼
        runtime-secret bootstrap process
          ├─ validates provider/config/allow-list
          ├─ selects exact item field labels
          ├─ refuses missing, duplicate, empty, or non-string values
          └─ spawns portal boot with an in-memory child environment
                    │
                    ▼
       migrations → provider registry → portal server
```

The bootstrap process is earlier than `portal-migrate-boot.sh`, Prisma, Auth.js, and application instrumentation. No resolved-value file is created. The child inherits resolved values; stdout/stderr carry names and reason codes only.

### 4.1 Provider contract

`DPF_SECRET_PROVIDER` is a closed startup value:

- empty or `environment`: use the environment unchanged;
- `onepassword-connect`: resolve configured logical names from one Connect item;
- any other value: refuse startup.

The implementation exposes a pure `resolveRuntimeSecrets({ env, fetch, readFile, signal })` seam plus a thin process launcher. Provider adapters return an environment overlay, never mutate databases or application state.

### 4.2 Logical-secret allow-list

The first allow-list is:

- `AUTH_SECRET`
- `CREDENTIAL_ENCRYPTION_KEY`
- `DATABASE_URL`

`DPF_RUNTIME_SECRET_NAMES` selects a comma-separated subset. For the 1Password provider the default is the two application root secrets. Unknown, duplicate, or empty names refuse startup. Adding a logical name is a contract change and must propagate across deployment wrappers per deployment contract §8.

### 4.3 1Password Connect configuration

- `DPF_ONEPASSWORD_CONNECT_HOST`: absolute HTTP(S) base URL.
- `DPF_ONEPASSWORD_CONNECT_TOKEN_FILE`: preferred path to a file containing only the token.
- `DPF_ONEPASSWORD_CONNECT_TOKEN`: fallback for wrappers without a secret-file mount.
- `DPF_ONEPASSWORD_VAULT_ID`: dedicated runtime-secret vault id.
- `DPF_ONEPASSWORD_ITEM_ID`: item id whose field labels equal logical secret names.
- `DPF_SECRET_PROVIDER_TIMEOUT_MS`: optional bounded timeout, default 5,000 ms and capped at 30,000 ms.

Supplying both token forms is ambiguous and refuses startup. URL, token, vault, and item are required. The token is never placed in request URLs or errors.

### 4.4 Fetch and field rules

The adapter sends one authenticated `GET /v1/vaults/{vaultId}/items/{itemId}`. It accepts one JSON object containing a `fields` array. Each requested logical name must match exactly one field `label` with a non-empty string `value`. Missing, duplicate, empty, malformed, non-2xx, timed-out, or network-failed responses refuse startup. Response bodies and values never appear in errors.

### 4.5 Authority boundaries

- `IntegrationCredential` remains the canonical connector store.
- `CREDENTIAL_ENCRYPTION_KEY` still performs DPF AES-256-GCM encryption; 1Password only supplies the key.
- Auth.js and DPF token code still interpret `AUTH_SECRET`; 1Password only supplies it.
- Step CA still issues and validates certificates. A vault may hold exported material, but it cannot become CA authority.
- LDAP still serves the DPF directory and Principal remains the authorization subject.
- 1Password access/audit is custody evidence; DPF receipts remain action evidence.

## 5. Flows

### FLOW-RSP-ENV—existing install

1. Compose starts the wrapper with no provider configured.
2. The wrapper selects `environment` without network access.
3. It validates required root variables are present.
4. It spawns the existing migration/start command unchanged.

### FLOW-RSP-1P—1Password-backed start

1. Operator creates a dedicated vault/item and narrowly scoped Connect token.
2. Deployment wrapper passes non-secret ids/host and a token file or token.
3. Bootstrap validates configuration and fetches one item.
4. Bootstrap extracts only allow-listed fields and overlays the child environment.
5. Migrations and portal start; no value is written to disk or logs.

### FLOW-RSP-REFUSE—provider unavailable or invalid

1. Bootstrap encounters invalid configuration, timeout, network error, non-2xx response, malformed item, or field mismatch.
2. It emits a stable, value-free failure naming the provider and category.
3. It does not run migrations or the portal command.
4. Operator restores Connect or rolls back to deliberately supplied environment values.

## 6. Failure, recovery, and rollback

The portal fails closed before database access. A running portal remains available if Connect later fails because this slice performs no per-request lookup. Restart requires Connect or an explicit provider rollback.

Rollback is operationally simple: set `DPF_SECRET_PROVIDER=environment`, restore the same logical values through the existing protected environment mechanism, and restart. Changing either root value is **not** rollback: changing `AUTH_SECRET` invalidates sessions/tokens and changing `CREDENTIAL_ENCRYPTION_KEY` can make stored ciphertext unreadable. Key rotation is separate governed work.

## 7. Security and compliance controls

- dedicated vault; no personal/shared vault;
- token file preferred, mode/access controlled by the deployment substrate;
- no item listing, writes, arbitrary field access, or per-request fetches;
- bounded timeout and one startup request;
- value-free logs and errors;
- diagnostics redact all `TOKEN`, `SECRET`, `PASSWORD`, `KEY`, and `AUTH` variables;
- vendor audit supplements but does not replace DPF evidence;
- no compliance claim based solely on vendor certifications;
- no silent fallback from an explicitly configured external provider to environment.

## 8. Acceptance contract

| Acceptance | Objective | Statement |
|---|---|---|
| AC-RSP-001 | OBJ-RSP-001 | With no provider configured, startup makes no network call and executes the existing command with required environment secrets unchanged. |
| AC-RSP-002 | OBJ-RSP-002 | A valid Connect item resolves the selected allow-listed fields before migrations and passes them only in the child process environment. |
| AC-RSP-003 | OBJ-RSP-002, OBJ-RSP-005 | Missing/dual token configuration, unknown provider/name, timeout, network error, non-2xx response, malformed JSON, and missing/duplicate/empty fields all refuse before command execution with no secret value in output. |
| AC-RSP-004 | OBJ-RSP-003 | No schema, Principal, LDAP, PKI, authorization, connector store, or audit ownership changes are introduced. |
| AC-RSP-005 | OBJ-RSP-004 | Provider selection and resolution are isolated from application consumers; the default remains environment and 1Password-specific names stay at the adapter edge. |
| AC-RSP-006 | OBJ-RSP-005 | Operator documentation states setup, dedicated-vault/token scope, outage behavior, threat limitation, rollback, and the danger of changing root values. |
| AC-RSP-007 | OBJ-RSP-001, OBJ-RSP-002 | Focused tests, production build, exact-tree pregate, secret scan, and semantic review pass. |

## 9. Non-goals and successors

- native DPF workforce MFA/passkeys;
- customer/social Principal-gate convergence;
- encryption-envelope key ids, read-old/write-new, or re-encryption;
- production container-exec/grant enforcement;
- moving social-provider or connector credentials into 1Password;
- service-account, Vault/OpenBao, cloud-manager, or Kubernetes adapters;
- bundling or operating Connect in DPF compose.

Each is independently shippable and therefore must have separate live backlog coverage rather than hiding in this plan.
