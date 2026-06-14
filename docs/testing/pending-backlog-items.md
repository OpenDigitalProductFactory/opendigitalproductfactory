# Pending Backlog Items — durable, reset-proof registry

> **Why this file exists.** Portal `BacklogItem`s live in PostgreSQL, which is **wiped and restored from the golden dump on every archetype-audit phase reset** (see [archetype-audit-plan.md](archetype-audit-plan.md) §5). Any BI filed into the portal during the testing window is destroyed on the next reset (§8a: *"Never file portal backlog items during audit runs"*). This git-committed ledger is the **temporarily durable** home for backlog items discovered while testing is in progress: it lives in the repo, so it survives every wipe; it gives each item a **stable reference** (`PBI-*` + a GitHub Issue number); and it is the source list from which real portal `BacklogItem`s are created **after** the audit, once the pre-audit `pg_dump` is restored ([archetype-audit-plan.md](archetype-audit-plan.md) §10).

> **How to refer to a pending BI:** use its `PBI-*` ref (stable, in this file) and/or its GitHub Issue number (stable, survives resets). Do **not** rely on a portal BI id during the testing window — those ids do not exist yet and any created mid-audit will be wiped.

## Lifecycle

1. **Discover** a gap / follow-up (e.g. from a fix PR or an audit run).
2. **Add a row** to the registry below with a new `PBI-*` ref.
3. For `critical` / `important` items, **file a GitHub Issue** (durable Channel 2 per §8b) and record its number here. `minor` / `observation` items may live here without an issue.
4. **After the audit + `pg_dump` restore:** `create_backlog_item` for each open row, record the real `BI-XXXXXXXX` id in the **Portal BI** column, then **close the GitHub Issue**.
5. Mark the row **filed** once it has a portal BI id (or **done** if the underlying work shipped first).

## Registry

| PBI ref | Title | Severity | Source | GitHub Issue | Portal BI (post-audit) | Status |
|---|---|---|---|---|---|---|
| PBI-INV-01 | SMTP configuration UI / onboarding prompt | important | [PR #1865](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1865) — Gap 2 follow-up | [#1875](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/1875) | — | open |
| PBI-INV-02 | Phase 2 — third-party e-signature (DocuSign/HelloSign) for standalone documents | important | [PR #1865](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1865) — Gap 3 Phase 2 | [#1876](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/1876) | — | open |
| PBI-INV-03 | Remove dead `InvoiceActions.tsx` (superseded by `InvoiceSendButton`) | minor | [PR #1865](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1865) cleanup | — (session task chip) | — | open |

## Details

### PBI-INV-01 — SMTP configuration UI / onboarding prompt
- **Severity:** important · **Issue:** #1875
- **Context:** PR #1865 added a send-time pre-flight (`isEmailConfigured()` → HTTP 422 with an actionable message) so "Send Invoice" no longer silently fails when SMTP is unconfigured. But SMTP is **env-var only** (`SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`) — there is no in-portal way to configure it, so a fresh-install operator cannot enable email delivery without shell/env access.
- **Scope:** a Settings → Email surface (and/or setup-wizard step) to enter SMTP config, stored via the credential-encryption layer (`CREDENTIAL_ENCRYPTION_KEY`); `isEmailConfigured()` / `sendEmail()` resolve from this store (env-var fallback retained).
- **Acceptance:** operator configures SMTP from the portal on a fresh install → "Send Invoice" delivers with no env var set; with nothing configured the 422 still surfaces.
- **Suggested epic at filing:** finance / invoicing (link to the existing finance epic when filing).

### PBI-INV-02 — Phase 2 third-party e-signature
- **Severity:** important · **Issue:** #1876
- **Context:** PR #1865 shipped Phase 1 (in-platform signature capture for invoices). Phase 2 covers third-party e-sign for **standalone documents** (engagement letters, service agreements) separate from invoices. Medium–large epic; warrants its own Build Studio run.
- **Scope:** integrate a third-party provider (DocuSign / HelloSign / PandaDoc) under DPF's bring-your-own-account conduit model; a document object + send-for-signature flow independent of `Invoice`; status webhooks → signed state + countersigned artifact storage.
- **Acceptance:** a legal/accountancy operator sends an engagement letter for signature, the client signs via the provider, and DPF records the signed document — no invoice required.
- **Suggested epic at filing:** new epic (professional-services e-signature).

### PBI-INV-03 — Remove dead `InvoiceActions.tsx`
- **Severity:** minor · **Tracking:** session task chip (also recorded here for durability)
- **Context:** `apps/web/app/(shell)/finance/invoices/[id]/InvoiceActions.tsx` is unreferenced dead code; the live send button is `apps/web/components/finance/InvoiceSendButton.tsx`. Safe deletion after confirming it is unimported.
