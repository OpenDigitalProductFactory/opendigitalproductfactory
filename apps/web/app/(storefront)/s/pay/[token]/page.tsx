// apps/web/app/(storefront)/s/pay/[token]/page.tsx
// PUBLIC — no auth required. Under (storefront) route group, /s/ prefix allows unauthenticated access.

import { getInvoiceByPayToken, markInvoiceViewed } from "@/lib/actions/finance";
import { notFound } from "next/navigation";

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
            style={{ margin: "0 0 4px", fontSize: 28, fontWeight: 700, color: "#111" }}
          >
            {invoice.invoiceRef}
          </h1>
          <p style={{ margin: "0 0 32px", color: "#6b7280", fontSize: 14 }}>
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
                <p style={{ margin: "0 0 4px", color: "#6b7280", fontSize: 14 }}>
                  Amount Due
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 32,
                    fontWeight: 700,
                    color: "#111",
                  }}
                >
                  {invoice.currency}{" "}
                  {due.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                </p>
                <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 13 }}>
                  Due{" "}
                  {new Date(invoice.dueDate).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </>
            )}
          </div>

          {/* Line items */}
          <table
            style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 0",
                    fontSize: 12,
                    color: "#6b7280",
                    fontWeight: 500,
                  }}
                >
                  Description
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 0",
                    fontSize: 12,
                    color: "#6b7280",
                    fontWeight: 500,
                  }}
                >
                  Qty
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 0",
                    fontSize: 12,
                    color: "#6b7280",
                    fontWeight: 500,
                  }}
                >
                  Price
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 0",
                    fontSize: 12,
                    color: "#6b7280",
                    fontWeight: 500,
                  }}
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((li, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td
                    style={{ padding: "10px 0", fontSize: 14, color: "#111" }}
                  >
                    {li.description}
                  </td>
                  <td
                    style={{
                      padding: "10px 0",
                      fontSize: 14,
                      color: "#6b7280",
                      textAlign: "right",
                    }}
                  >
                    {Number(li.quantity)}
                  </td>
                  <td
                    style={{
                      padding: "10px 0",
                      fontSize: 14,
                      color: "#6b7280",
                      textAlign: "right",
                    }}
                  >
                    {invoice.currency}{" "}
                    {Number(li.unitPrice).toLocaleString("en-GB", {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                  <td
                    style={{
                      padding: "10px 0",
                      fontSize: 14,
                      color: "#111",
                      textAlign: "right",
                      fontWeight: 500,
                    }}
                  >
                    {invoice.currency}{" "}
                    {Number(li.lineTotal).toLocaleString("en-GB", {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div
            style={{ borderTop: "2px solid #e5e7eb", paddingTop: 16, marginBottom: 32 }}
          >
            <div
              style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}
            >
              <span style={{ fontSize: 14, color: "#6b7280" }}>Subtotal</span>
              <span style={{ fontSize: 14, color: "#111" }}>
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
                <span style={{ fontSize: 14, color: "#6b7280" }}>Tax</span>
                <span style={{ fontSize: 14, color: "#111" }}>
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
              <span style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>
                Total
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>
                {invoice.currency}{" "}
                {total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Pay Now button — placeholder until Stripe integration */}
          {!isPaid && (
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <p
                style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}
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
              <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>
                {invoice.notes}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
