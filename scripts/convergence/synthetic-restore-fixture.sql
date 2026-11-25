-- Synthetic business records for the DPF -> DPF2 Gate 3 restore rehearsal (BI-3357F36E).
--
-- Every row here is fictional. Nothing is copied from any install. Names use the
-- reserved example.test domain, and the one User row carries a placeholder that is
-- not a password hash, so the dump holds no credential.
--
-- The rows form one complete recurring customer chain, the slice the export
-- contract exercises (docs/superpowers/specs/2026-11-22-dpf-to-dpf2-convergence-
-- export-and-cutover-readiness.md, Slice 3):
--   Organization -> CustomerAccount -> CustomerContact -> Subscription ->
--   RecurringSchedule (+ line item) -> Invoice x2 (+ line items) ->
--   InvoiceDocument -> DocumentVersion -> Document, DocumentBlob
-- plus a creator User mapped to a Principal through PrincipalAlias(user), and one
-- invoice whose creator has no alias, so the unresolved-creator path is covered.
-- Amounts use scales that a double cannot carry, so a restore that rounds them
-- fails parity.

\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO "Organization" (id, "orgId", name, slug, "updatedAt")
VALUES ('syn-org-1', 'ORG-SYN-0001', 'Example Trading Co (synthetic)', 'example-trading-synthetic', '2026-11-24 00:00:00');

INSERT INTO "User" (id, email, "passwordHash")
VALUES ('syn-user-owner', 'owner@example.test', '!synthetic-no-login'),
       ('syn-user-unmapped', 'former-clerk@example.test', '!synthetic-no-login');

INSERT INTO "Principal" (id, "principalId", kind, "displayName", status, "updatedAt")
VALUES ('syn-principal-owner', 'PRN-SYN-0001', 'human', 'Example Owner (synthetic)', 'active', '2026-11-24 00:00:00');

INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer)
VALUES ('syn-alias-owner', 'syn-principal-owner', 'user', 'syn-user-owner', '');

INSERT INTO "CustomerAccount" (id, "accountId", name, "updatedAt")
VALUES ('syn-account-1', 'CA-SYN-0001', 'Harbour Bakery (synthetic)', '2026-11-24 00:00:00');

INSERT INTO "CustomerContact" (id, email, "accountId", "updatedAt")
VALUES ('syn-contact-1', 'accounts@harbour-bakery.example.test', 'syn-account-1', '2026-11-24 00:00:00');

INSERT INTO "ContactAccountRole" (id, "contactId", "accountId")
VALUES ('syn-role-1', 'syn-contact-1', 'syn-account-1');

INSERT INTO "Subscription" (id, "subscriptionRef", "accountId", "planName", "totalValue", "renewalDate", "updatedAt")
VALUES ('syn-sub-1', 'SUB-SYN-0001', 'syn-account-1', 'Managed support (synthetic)', 1234.567890123456789, '2027-01-01 00:00:00', '2026-11-24 00:00:00');

INSERT INTO "RecurringSchedule" (id, "scheduleId", "accountId", name, frequency, amount, currency, "startDate", "nextInvoiceDate", "lastInvoicedAt", "updatedAt", "createdById", "subscriptionId")
VALUES ('syn-schedule-internal-1', 'RS-SYN-0001', 'syn-account-1', 'Monthly support (synthetic)', 'monthly',
        102.880657510288065751028806575, 'USD', '2026-09-01 00:00:00', '2026-12-01 00:00:00', '2026-11-01 00:00:00',
        '2026-11-24 00:00:00', 'syn-user-owner', 'syn-sub-1');

INSERT INTO "RecurringLineItem" (id, "scheduleId", description, quantity, "unitPrice", "taxRate", "sortOrder")
VALUES ('syn-rli-1', 'syn-schedule-internal-1', 'Support hours (synthetic)', 3, 31.666666666666666666666666667, 0.0825, 0);

INSERT INTO "Invoice" (id, "invoiceRef", "accountId", "dueDate", "issueDate", subtotal, "taxAmount", "totalAmount", "amountDue", "updatedAt", "sourceType", "sourceId", "createdById")
VALUES ('syn-inv-1', 'INV-SYN-0001', 'syn-account-1', '2026-10-31 00:00:00', '2026-10-01 00:00:00', 95.000000000000000000000000001, 7.837500000000000000000000000, 102.837500000000000000000000001, 0, '2026-11-24 00:00:00', 'recurring', 'syn-schedule-internal-1', 'syn-user-owner'),
       ('syn-inv-2', 'INV-SYN-0002', 'syn-account-1', '2026-11-30 00:00:00', '2026-11-01 00:00:00', 95.000000000000000000000000001, 7.837500000000000000000000000, 102.837500000000000000000000001, 102.837500000000000000000000001, '2026-11-24 00:00:00', 'recurring', 'syn-schedule-internal-1', 'syn-user-unmapped');

INSERT INTO "InvoiceLineItem" (id, "invoiceId", description, quantity, "unitPrice", "taxRate", "taxAmount", "lineTotal")
VALUES ('syn-ili-1', 'syn-inv-1', 'Support hours (synthetic)', 3, 31.666666666666666666666666667, 0.0825, 7.8375, 102.837500000000000000000000001),
       ('syn-ili-2', 'syn-inv-2', 'Support hours (synthetic)', 3, 31.666666666666666666666666667, 0.0825, 7.8375, 102.837500000000000000000000001);

-- The blob row describes a synthetic file; its bytes are written by the build
-- script and listed in the provenance record, not in this database.
INSERT INTO "DocumentBlob" (id, sha256, "storageKey", "sizeBytes")
VALUES ('syn-blob-1', :'blob_sha256', 'documents/sha256/' || substr(:'blob_sha256', 1, 2) || '/' || substr(:'blob_sha256', 3, 2) || '/' || :'blob_sha256', :blob_size);

INSERT INTO "Document" (id, "documentId", "organizationId", title, "documentKind", "contentFormat", "updatedAt")
VALUES ('syn-doc-1', 'DOC-SYN-0001', 'syn-org-1', 'Invoice INV-SYN-0001 sent copy (synthetic)', 'invoice', 'pdf', '2026-11-24 00:00:00');

INSERT INTO "DocumentVersion" (id, "documentId", version, title, "contentFormat", "contentBlobId", "contentSha256", "sizeBytes")
VALUES ('syn-docver-1', 'syn-doc-1', 1, 'Invoice INV-SYN-0001 sent copy (synthetic)', 'pdf', 'syn-blob-1', :'blob_sha256', :blob_size);

UPDATE "Document" SET "currentVersionId" = 'syn-docver-1' WHERE id = 'syn-doc-1';

INSERT INTO "InvoiceDocument" (id, "invoiceId", "documentVersionId", role, revision, "createdById")
VALUES ('syn-invdoc-1', 'syn-inv-1', 'syn-docver-1', 'sent-copy', 1, 'syn-user-owner');

COMMIT;
