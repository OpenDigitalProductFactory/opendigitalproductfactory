import { prisma } from "@dpf/db";
import { saveManagedDocument } from "@/lib/documents/document-store";
import { writeDocumentBlob } from "@/lib/documents/blob-storage";

/**
 * Persisting the invoice document a customer actually received.
 *
 * Before this existed, generateInvoicePdf() rendered on demand and the bytes were
 * streamed to the download route or attached to an email and then discarded. So
 * re-downloading an invoice later re-rendered from CURRENT data: after any edit,
 * the operator and the customer were looking at different documents under the
 * same invoice ref, with nothing to tell them apart. That is an audit failure,
 * and it is why revisions could not be tracked at all.
 *
 * A snapshot is WRITE-ONCE. Reissuing appends revision N+1; nothing ever mutates
 * revision N, because the whole point is that what was sent stays recoverable
 * exactly as it was sent.
 */

export const INVOICE_DOCUMENT_ROLES = ["sent-copy", "signed-copy", "credit-note"] as const;
export type InvoiceDocumentRole = (typeof INVOICE_DOCUMENT_ROLES)[number];

export type SnapshotInvoiceDocumentInput = {
  invoiceId: string;
  invoiceRef: string;
  accountName: string;
  pdf: Buffer;
  role?: InvoiceDocumentRole;
  sentToEmail?: string | null;
  createdById?: string | null;
};

export type InvoiceDocumentSnapshot = {
  id: string;
  revision: number;
  role: string;
  documentVersionId: string;
  sha256: string;
  sizeBytes: number;
  sentToEmail: string | null;
  createdAt: Date;
};

/**
 * Next revision for this (invoice, role). Read inside the caller's flow rather
 * than derived from a count, so a deleted row could never cause a revision to be
 * reused — the unique constraint is the real guard either way.
 */
async function nextRevision(invoiceId: string, role: string): Promise<number> {
  const latest = await prisma.invoiceDocument.findFirst({
    where: { invoiceId, role },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  return (latest?.revision ?? 0) + 1;
}

export async function snapshotInvoiceDocument(
  input: SnapshotInvoiceDocumentInput,
): Promise<InvoiceDocumentSnapshot> {
  const role = input.role ?? "sent-copy";

  // Content-addressed: an unchanged reissue writes no new bytes, it just points a
  // new version at the same blob.
  const written = await writeDocumentBlob({ content: input.pdf });
  const blob = await prisma.documentBlob.upsert({
    where: { sha256: written.sha256 },
    update: {},
    create: {
      sha256: written.sha256,
      storageKey: written.storageKey,
      mimeType: "application/pdf",
      sizeBytes: written.sizeBytes,
    },
    select: { id: true },
  });

  const revision = await nextRevision(input.invoiceId, role);

  // One Document per (invoice, role), gaining a new DocumentVersion per revision —
  // so the document store's own version history lines up with the revision number.
  const documentId = `INVDOC-${input.invoiceId}-${role}`;
  const saved = await saveManagedDocument({
    documentId,
    title: `${input.invoiceRef} — ${input.accountName}`,
    documentKind: "invoice",
    contentFormat: "application/pdf",
    contentBlobId: blob.id,
    contentSha256: written.sha256,
    summary: `Revision ${revision} of ${input.invoiceRef} (${role}).`,
    tags: ["finance", "invoice", role],
    accessScope: "organization",
  });

  const versionId = saved.currentVersionId;
  if (!versionId) {
    throw new Error(
      `Document ${documentId} saved without a current version; cannot bind an invoice snapshot to nothing.`,
    );
  }

  const row = await prisma.invoiceDocument.create({
    data: {
      invoiceId: input.invoiceId,
      documentVersionId: versionId,
      role,
      revision,
      sentToEmail: input.sentToEmail ?? null,
      createdById: input.createdById ?? null,
    },
    select: {
      id: true,
      revision: true,
      role: true,
      documentVersionId: true,
      sentToEmail: true,
      createdAt: true,
    },
  });

  return {
    ...row,
    sha256: written.sha256,
    sizeBytes: written.sizeBytes,
  };
}

export type InvoiceDocumentListEntry = {
  id: string;
  revision: number;
  role: string;
  sentToEmail: string | null;
  createdAt: Date;
  sizeBytes: number | null;
  sha256: string | null;
  /** The User model carries no display name; email is the identifying field. */
  createdByEmail: string | null;
};

/** Newest first — the most recent revision is what an operator usually wants. */
export async function listInvoiceDocuments(invoiceId: string): Promise<InvoiceDocumentListEntry[]> {
  const rows = await prisma.invoiceDocument.findMany({
    where: { invoiceId },
    orderBy: [{ role: "asc" }, { revision: "desc" }],
    select: {
      id: true,
      revision: true,
      role: true,
      sentToEmail: true,
      createdAt: true,
      documentVersion: { select: { sizeBytes: true, contentSha256: true } },
      createdBy: { select: { email: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    revision: r.revision,
    role: r.role,
    sentToEmail: r.sentToEmail,
    createdAt: r.createdAt,
    sizeBytes: r.documentVersion?.sizeBytes ?? null,
    sha256: r.documentVersion?.contentSha256 ?? null,
    createdByEmail: r.createdBy?.email ?? null,
  }));
}

export type InvoiceDocumentBytes = {
  storageKey: string;
  sha256: string;
  mimeType: string;
  filename: string;
  invoiceRef: string;
};

/**
 * Locate the stored bytes for one snapshot. Returns the storage key rather than
 * the buffer so the caller decides how to stream it.
 */
export async function getInvoiceDocumentBlobRef(
  invoiceDocumentId: string,
): Promise<InvoiceDocumentBytes | null> {
  const row = await prisma.invoiceDocument.findUnique({
    where: { id: invoiceDocumentId },
    select: {
      revision: true,
      role: true,
      invoice: { select: { invoiceRef: true } },
      documentVersion: {
        select: { contentSha256: true, contentBlob: { select: { storageKey: true, mimeType: true } } },
      },
    },
  });

  const blob = row?.documentVersion?.contentBlob;
  if (!row || !blob) return null;

  return {
    storageKey: blob.storageKey,
    sha256: row.documentVersion.contentSha256 ?? "",
    mimeType: blob.mimeType ?? "application/pdf",
    filename: `${row.invoice.invoiceRef}-${row.role}-r${row.revision}.pdf`,
    invoiceRef: row.invoice.invoiceRef,
  };
}
