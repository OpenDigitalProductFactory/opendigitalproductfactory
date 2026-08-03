import { listInvoiceDocuments } from "@/lib/finance/invoice-document-store";
import { InvoiceDocumentTable } from "@/components/finance/InvoiceDocumentTable";

type Props = { invoiceId: string };

/**
 * The documents the customer actually received.
 *
 * Deliberately separated from the Download button in the action row: that button
 * RE-RENDERS the invoice from current data, so after an edit it will not match
 * what was sent. Conflating the two is the audit trap this section exists to
 * close, which is why the distinction is stated in the UI and not just in a doc.
 */
export async function InvoiceDocumentHistory({ invoiceId }: Props) {
  const documents = await listInvoiceDocuments(invoiceId);

  return (
    <section className="mb-dpf-lg">
      <h2 className="text-dpf-caption uppercase tracking-widest text-[var(--dpf-muted)] mb-dpf-sm">
        Sent Documents
      </h2>

      {documents.length === 0 ? (
        <div className="rounded-dpf-lg border border-[var(--dpf-border)] p-dpf-md">
          <p className="text-dpf-body text-[var(--dpf-muted)]">
            No document has been sent yet. Sending this invoice stores a permanent copy
            here, exactly as the customer receives it.
          </p>
        </div>
      ) : (
        <>
          <InvoiceDocumentTable
            invoiceId={invoiceId}
            rows={documents.map((d) => ({
              id: d.id,
              revision: d.revision,
              role: d.role,
              sentToEmail: d.sentToEmail,
              createdAt: d.createdAt,
              sizeBytes: d.sizeBytes,
            }))}
          />
          <p className="mt-dpf-xs text-dpf-caption text-[var(--dpf-muted)]">
            These are stored copies, unchanged since they were sent. The Download button
            above re-creates the invoice from its current details, so the two can differ
            after an edit.
          </p>
        </>
      )}
    </section>
  );
}
