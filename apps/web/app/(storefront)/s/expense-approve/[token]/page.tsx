// apps/web/app/(storefront)/s/expense-approve/[token]/page.tsx
// PUBLIC — no auth required. Token-based expense claim approval page.
// Light theme (inline styles), same pattern as the bill approval page.

import { getExpenseClaimByApprovalToken } from "@/lib/actions/expenses";
import { notFound } from "next/navigation";
import { ExpenseApprovalForm } from "./ExpenseApprovalForm";

const CATEGORY_LABELS: Record<string, string> = {
  travel: "Travel",
  meals: "Meals",
  accommodation: "Accommodation",
  supplies: "Supplies",
  mileage: "Mileage",
  other: "Other",
};

type Props = { params: Promise<{ token: string }> };

export default async function ExpenseApprovePage({ params }: Props) {
  const { token } = await params;
  const claim = await getExpenseClaimByApprovalToken(token);
  if (!claim) notFound();

  const isAlreadyResolved = claim.status !== "submitted";
  const total = Number(claim.totalAmount);
  const formatMoney = (n: number) =>
    n.toLocaleString("en-GB", { minimumFractionDigits: 2 });

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
              color: "#111827",
            }}
          >
            Expense Claim Approval
          </h1>
          <p style={{ margin: "0 0 32px", color: "#6b7280", fontSize: 14 }}>
            {claim.claimId} · {claim.employee.displayName}
          </p>

          {/* Already resolved banner */}
          {isAlreadyResolved && (
            <div
              style={{
                background: claim.status === "approved" ? "#f0fdf4" : "#fff1f2",
                border: `1px solid ${claim.status === "approved" ? "#bbf7d0" : "#fecdd3"}`,
                borderRadius: 8,
                padding: "16px 20px",
                marginBottom: 32,
                color: claim.status === "approved" ? "#15803d" : "#be123c",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              This approval request has already been{" "}
              {claim.status === "approved" ? "approved" : claim.status}.
            </div>
          )}

          {/* Claim summary */}
          <div
            style={{
              background: "#f3f4f6",
              borderRadius: 8,
              padding: 24,
              marginBottom: 32,
            }}
          >
            {[
              { label: "Employee", value: claim.employee.displayName },
              { label: "Claim ID", value: claim.claimId, mono: true },
              { label: "Title", value: claim.title },
            ].map(({ label, value, mono }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 14, color: "#6b7280" }}>{label}</span>
                <span
                  style={{
                    fontSize: 14,
                    color: "#111827",
                    fontWeight: 600,
                    fontFamily: mono ? "monospace" : undefined,
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                paddingTop: 8,
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
                Total
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
                {claim.currency} {formatMoney(total)}
              </span>
            </div>
          </div>

          {/* Expense items table */}
          <table
            style={{ width: "100%", borderCollapse: "collapse", marginBottom: 32 }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                {["Date", "Category", "Description", "Amount"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === "Amount" ? "right" : "left",
                      padding: "8px 0",
                      fontSize: 12,
                      color: "#6b7280",
                      fontWeight: 500,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {claim.items.map((item, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "10px 0", fontSize: 14, color: "#6b7280" }}>
                    {new Date(item.date).toLocaleDateString("en-GB")}
                  </td>
                  <td style={{ padding: "10px 0", fontSize: 14, color: "#374151" }}>
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </td>
                  <td style={{ padding: "10px 0", fontSize: 14, color: "#111827" }}>
                    {item.description}
                  </td>
                  <td
                    style={{
                      padding: "10px 0",
                      fontSize: 14,
                      color: "#111827",
                      textAlign: "right",
                      fontWeight: 500,
                    }}
                  >
                    {claim.currency} {formatMoney(Number(item.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Approve / Reject form */}
          {!isAlreadyResolved && <ExpenseApprovalForm token={token} />}
        </div>
      </div>
    </div>
  );
}
