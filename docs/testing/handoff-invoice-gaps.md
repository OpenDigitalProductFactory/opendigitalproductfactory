# Handoff: Invoice System Gap Closure

**Context:** Fresh-install archetype audit (Runs 6 & 7) uncovered three invoice gaps. This thread closes all three as code changes via PR. The portal is running at `http://localhost:3000` (admin: `admin@dpf.local` / `changeme123`). Work directly in a new worktree branched from `origin/main`.

---

## Gap 1 — Tax rate default not wired to org's wizard selection (BUG)

**Observed:** Every invoice form defaults the TAX % field to **20%** regardless of whether the operator selected "No VAT" during the setup wizard. Confirmed across all 6 archetypes tested (Runs 6 and 7).

**Root cause (already researched):**
- Schema default in `apps/web/lib/finance/finance-validation.ts` is `taxRate: z.number().min(0).max(100).default(0)` — so the schema is 0, but something upstream passes 20 to the UI
- `apps/web/components/finance/CreateBillForm.tsx` has a `defaultTaxRate` prop (lines 42–43); find what passes 20 to it
- The org's VAT selection is stored in `organization.taxProfile` (Prisma schema) — `vatRegistered` boolean + country — but nothing reads it at invoice creation time

**Fix required:**
1. Find where `defaultTaxRate=20` (or equivalent) is passed to `CreateBillForm` and trace back to the invoice new/edit page
2. Replace the hardcoded value with a lookup of `org.taxProfile` — if `vatRegistered=false`, default to 0; if `vatRegistered=true`, use the registered rate (or country-appropriate standard rate)
3. The `createInvoice` server action (`apps/web/lib/actions/finance.ts`, lines 71–139) uses `item.taxRate ?? 0` — no change needed there; the fix is at the UI default layer
4. Write a test: `new invoice form on No-VAT org → TAX % field pre-filled with 0`; `new invoice form on VAT-registered org → TAX % field pre-filled with org's rate`

---

## Gap 2 — Send Invoice: SMTP not verified on cold-start fresh install

**Observed:** The "Send Invoice" button is present on every saved invoice detail page. The implementation IS complete:
- `POST /api/v1/finance/invoices/:id/send` → marks `sentAt`, generates PDF via `@react-pdf/renderer`, composes HTML email with "Pay Now" button linking to `/s/pay/{payToken}`, attaches PDF, sends via platform email service

**What was NOT verified:** Whether SMTP is configured out of the box on a fresh install. If the platform ships with no default SMTP config, clicking "Send Invoice" silently fails (no email delivered, no error surfaced to the operator).

**Fix required:**
1. Check what the send flow does when SMTP is not configured — does it return an error the UI surfaces, or does it swallow the failure?
2. If it swallows: add a pre-flight check before send — if no SMTP config exists, return a 422 with a message the UI renders: "Email delivery is not configured. Go to Settings → Email to set up SMTP."
3. Check whether the setup wizard or onboarding surfaces SMTP configuration — if not, add a prompt or link
4. Functional test: drive "Send Invoice" on a fresh install with no SMTP config → confirm the error is surfaced to the operator (not a silent no-op)

---

## Gap 3 — Document signing: no e-signature flow exists

**Observed:** No DocuSign, HelloSign, PandaDoc, or any e-signature integration exists anywhere in the codebase. The `Invoice` Prisma model has no `signedAt`, `signedBy`, or `signatureUrl` fields. The `SignatureField` component in `apps/mobile/dynamic/fields/SignatureField.tsx` is a placeholder stub only.

**Why this matters:** For professional services archetypes — legal-practice, accountancy, counselling-wellness, it-managed-services — engagement letters and service agreements require client signatures before work begins. Sending a PDF invoice is not a binding contract for regulated services.

**Fix required — phased, scope this PR to Phase 1 only:**

**Phase 1 (this PR):** In-platform signature capture for invoices and service agreements
- Add `signedAt DateTime?`, `signedByName String?`, `signedByEmail String?`, `signatureDataUrl String?` to the `Invoice` model (Prisma migration)
- When "Send Invoice" is triggered, add an option: "Require signature before payment" (toggle, default off; archetype-specific default — on for legal/accountancy)
- The payment portal page (`/s/pay/{payToken}`) — if signature required and not yet captured: show a signature capture pad (canvas draw or typed name) before the Pay Now button is enabled
- Once signed: write `signedAt`/`signedByName`/`signedByEmail` to the DB, send a signed confirmation email with the countersigned PDF
- Invoice detail page in admin: show signature status (unsigned / signed by / signed at)

**Phase 2 (file a BI, do not implement in this PR):** Third-party e-signature integration (DocuSign / HelloSign) for standalone document workflows (engagement letters separate from invoices). This is a medium–large epic and needs its own Build Studio run.

**Acceptance criteria for Phase 1:**
- Legal/accountancy archetypes: new invoice created → Send Invoice → "Require signature" is on by default → customer receives email with payment link → payment portal shows signature pad → customer signs → admin invoice shows "Signed by [name] at [timestamp]" → payment proceeds
- Counselling/IT archetypes: "Require signature" defaults off; operator can enable per invoice
- No-signature flow (Phase 2 scope) still works unchanged for non-professional-services archetypes

---

## Execution rules for this thread

- Work in a fresh worktree branched from `origin/main` (not from a test/doc branch)
- Every commit needs `Signed-off-by:` (`git commit -s`)
- Run `pnpm exec vitest` from the repo root before pushing — CI will fail otherwise
- Functional verification: drive the happy path on the live install for each gap before marking done — structural verification (tests pass, types check) is not sufficient
- Open a single PR covering all three gaps, or separate PRs if the changes are cleanly separable
- Do NOT reset the DB; rebuild images only (`scripts/build-images.ps1`) if the image needs to reflect code changes
- Admin credentials: `admin@dpf.local` / `changeme123` at `http://localhost:3000`
- `MSYS_NO_PATHCONV=1` required for any `docker exec` commands with Unix-style paths on Windows

---

## Key files

| Gap | File | Notes |
|-----|------|-------|
| Tax | `apps/web/components/finance/CreateBillForm.tsx` | Find the 20% hardcode |
| Tax | `apps/web/lib/finance/finance-validation.ts` | Schema (correct, default 0) |
| Tax | `apps/web/lib/actions/finance.ts:71–139` | Server action (no change needed) |
| Send | `apps/web/app/api/v1/finance/invoices/[id]/send/route.ts` | Add SMTP pre-flight |
| Send | `apps/web/lib/shared/email.ts` | Email send utility |
| Sign | `packages/db/prisma/schema.prisma` | Add signature fields to Invoice |
| Sign | `apps/web/app/s/pay/[token]/page.tsx` | Payment portal — add signature step |
| Sign | `apps/web/app/finance/invoices/[id]/page.tsx` | Show signature status in admin |
