// apps/web/app/(storefront)/s/approve/[token]/page.tsx
// PUBLIC — no auth required. Token-based bill approval page.
// Light theme (inline styles), same pattern as the Pay Now page.

import { getBillByApprovalToken } from "@/lib/actions/ap";
import { notFound } from "next/navigation";
import { ApprovalForm } from "./ApprovalForm";

type Props = { params: Promise<{ token: string }> };

export default async function ApproveBillPage({ params }: Props) {
  const { token } = await params;
  const approval = await getBillByApprovalToken(token);
  if (!approval) notFound();

  const bill = approval.bill;
  const isAlreadyResolved = approval.status !== "pending";
  const total = Number(bill.totalAmount);

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
        <div
          style={{
            background: "white",
            borderRadius: 12,
            padding: 40,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          {/* Header */}
          <h1
            style={{
              margin: "0 0 4px",
              fontSize: 28,
              fontWeight: 700,
              color: "var(--dpf-text)",
            }}
          >
            Bill Approval
          </h1>
          <p style={{ margin: "0 0 32px", color: "var(--dpf-muted)", fontSize: 14 }}>
            {bill.billRef} · {bill.supplier.name}
          </p>

          {/* Already resolved banner */}
          {isAlreadyResolved && (
            <div
              style={{
                background: approval.status === "approved" ? "#f0fdf4" : "#fff1f2",
                border: `1px solid ${approval.status === "approved" ? "#bbf7d0" : "#fecdd3"}`,
                borderRadius: 8,
                padding: "16px 20px",
                marginBottom: 32,
                color: approval.status === "approved" ? "#15803d" : "#be123c",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              This approval request has already been{" "}
              {approval.status === "approved" ? "approved" : "rejected"}.
            </div>
          )}

          {/* Bill summary */}
          <div
            style={{
              background: "#f3f4f6",
              borderRadius: 8,
              padding: 24,
              marginBottom: 32,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 14, color: "var(--dpf-muted)" }}>Supplier</span>
              <span style={{ fontSize: 14, color: "var(--dpf-text)", fontWeight: 600 }}>
                {bill.supplier.name}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 14, color: "var(--dpf-muted)" }}>Bill Ref</span>
              <span style={{ fontSize: 14, color: "var(--dpf-text)", fontFamily: "monospace" }}>
                {bill.billRef}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 14, color: "var(--dpf-muted)" }}>Due Date</span>
              <span style={{ fontSize: 14, color: "var(--dpf-text)" }}>
                {new Date(bill.dueDate).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
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
                {bill.currency}{" "}
                {total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Line items */}
          <table
            style={{ width: "100%", borderCollapse: "collapse", marginBottom: 32 }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 0",
                    fontSize: 12,
                    color: "var(--dpf-muted)",
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
                    color: "var(--dpf-muted)",
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
                    color: "var(--dpf-muted)",
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
                    color: "var(--dpf-muted)",
                    fontWeight: 500,
                  }}
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {bill.lineItems.map((li, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "10px 0", fontSize: 14, color: "var(--dpf-text)" }}>
                    {li.description}
                  </td>
                  <td
                    style={{
                      padding: "10px 0",
                      fontSize: 14,
                      color: "var(--dpf-muted)",
                      textAlign: "right",
                    }}
                  >
                    {Number(li.quantity)}
                  </td>
                  <td
                    style={{
                      padding: "10px 0",
                      fontSize: 14,
                      color: "var(--dpf-muted)",
                      textAlign: "right",
                    }}
                  >
                    {bill.currency}{" "}
                    {Number(li.unitPrice).toLocaleString("en-GB", {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                  <td
                    style={{
                      padding: "10px 0",
                      fontSize: 14,
                      color: "var(--dpf-text)",
                      textAlign: "right",
                      fontWeight: 500,
                    }}
                  >
                    {bill.currency}{" "}
                    {Number(li.lineTotal).toLocaleString("en-GB", {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Approve / Reject form */}
          {!isAlreadyResolved && <ApprovalForm token={token} />}
        </div>
      </div>
    </div>
  );
}
