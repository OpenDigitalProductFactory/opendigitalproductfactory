// apps/web/app/(storefront)/s/pay/[token]/page.tsx
// PUBLIC — no auth required. Under (storefront) route group, /s/ prefix allows unauthenticated access.

import { getInvoiceByPayToken, markInvoiceViewed } from "@/lib/actions/finance";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/LocalTime";
import { InvoiceSignaturePad } from "@/components/finance/InvoiceSignaturePad";
import { PublicLineItemsTable } from "@/components/storefront/PublicLineItemsTable";

type Props = { params: Promise<{ token: string }> };

export default async function PayPage({ params }: Props) {
  const { token } = await params;
  const invoice = await getInvoiceByPayToken(token);
  if (!invoice) notFound();

  // Track view
  if (!invoice.viewedAt && invoice.status === "sent") {
    await markInvoiceViewed(invoice.id);
  }

  const isPaid = invoice.status === "paid";
  const total = Number(invoice.totalAmount);
  const due = Number(invoice.amountDue);
  // Signature gate (Phase 1 e-sign): block the Pay Now flow until the customer signs.
  const needsSignature = invoice.signatureRequired && !invoice.signedAt;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f9fafb",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 20px" }}>
        {/* Invoice card */}
        <div
          style={{
            background: "white",
            borderRadius: 12,
            padding: 40,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h1
            style={{ margin: "0 0 4px", fontSize: 28, fontWeight: 700, color: "var(--dpf-text)" }}
          >
            {invoice.invoiceRef}
          </h1>
          <p style={{ margin: "0 0 32px", color: "var(--dpf-muted)", fontSize: 14 }}>
            Invoice for {invoice.account.name}
          </p>

          {/* Amount due block */}
          <div
            style={{
              background: isPaid ? "#f0fdf4" : "#f3f4f6",
              borderRadius: 8,
              padding: 24,
              marginBottom: 32,
              textAlign: "center",
            }}
          >
            {isPaid ? (
              <>
                <p
                  style={{
                    margin: "0 0 4px",
                    color: "#22c55e",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  PAID
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 32,
                    fontWeight: 700,
                    color: "#22c55e",
                  }}
                >
                  {invoice.currency}{" "}
                  {total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: "0 0 4px", color: "var(--dpf-muted)", fontSize: 14 }}>
                  Amount Due
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 32,
                    fontWeight: 700,
                    color: "var(--dpf-text)",
                  }}
                >
                  {invoice.currency}{" "}
                  {due.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                </p>
                <p style={{ margin: "8px 0 0", color: "var(--dpf-muted)", fontSize: 13 }}>
                  Due{" "}
                  <LocalTime
                    value={invoice.dueDate}
                    utc
                    options={{ day: "numeric", month: "long", year: "numeric" }}
                  />
                </p>
              </>
            )}
          </div>

          {/* Line items — shared report-kit DataTable (BI-F7792FC1) */}
          <PublicLineItemsTable
            rows={invoice.lineItems.map((li, i) => ({
              id: `${invoice.id}-${i}`,
              description: li.description,
              quantity: Number(li.quantity),
              unitPrice: Number(li.unitPrice),
              lineTotal: Number(li.lineTotal),
              currency: invoice.currency,
            }))}
          />

          {/* Totals */}
          <div
            style={{ borderTop: "2px solid #e5e7eb", paddingTop: 16, marginBottom: 32 }}
          >
            <div
              style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}
            >
              <span style={{ fontSize: 14, color: "var(--dpf-muted)" }}>Subtotal</span>
              <span style={{ fontSize: 14, color: "var(--dpf-text)" }}>
                {invoice.currency}{" "}
                {Number(invoice.subtotal).toLocaleString("en-GB", {
                  minimumFractionDigits: 2,
                })}
              </span>
            </div>
            {Number(invoice.taxAmount) > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 14, color: "var(--dpf-muted)" }}>Tax</span>
                <span style={{ fontSize: 14, color: "var(--dpf-text)" }}>
                  {invoice.currency}{" "}
                  {Number(invoice.taxAmount).toLocaleString("en-GB", {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                paddingTop: 8,
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 700, color: "var(--dpf-text)" }}>
                Total
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, color: "var(--dpf-text)" }}>
                {invoice.currency}{" "}
                {total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Signature gate — capture before payment is enabled */}
          {needsSignature && (
            <InvoiceSignaturePad token={token} defaultEmail={invoice.contact?.email ?? null} />
          )}

          {/* Signed confirmation */}
          {invoice.signatureRequired && invoice.signedAt && (
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 8,
                padding: 16,
                marginBottom: 24,
              }}
            >
              <p style={{ margin: "0 0 2px", color: "#16a34a", fontSize: 13, fontWeight: 600 }}>
                Signed
              </p>
              <p style={{ margin: 0, color: "#374151", fontSize: 13 }}>
                Signed by {invoice.signedByName ?? invoice.signedByEmail ?? "the customer"} on{" "}
                <LocalTime
                  value={invoice.signedAt}
                  options={{ day: "numeric", month: "long", year: "numeric" }}
                />
              </p>
            </div>
          )}

          {/* Pay Now button — placeholder until Stripe integration */}
          {!isPaid && !needsSignature && (
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <p
                style={{ fontSize: 13, color: "var(--dpf-muted)", marginBottom: 12 }}
              >
                To pay, please transfer to the bank details provided in your
                invoice email, or contact us for alternative payment options.
              </p>
              <div
                style={{
                  display: "inline-block",
                  background: "#22c55e",
                  color: "white",
                  fontSize: 18,
                  fontWeight: 600,
                  padding: "16px 48px",
                  borderRadius: 8,
                  opacity: 0.5,
                }}
              >
                Pay Now (Coming Soon)
              </div>
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
                Online payments will be available shortly via Stripe.
              </p>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
              <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: 0 }}>
                {invoice.notes}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
