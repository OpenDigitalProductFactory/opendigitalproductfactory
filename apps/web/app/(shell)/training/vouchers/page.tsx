import { getAllVouchers } from "@/lib/actions/training";

export default async function VouchersPage() {
  const vouchers = await getAllVouchers();

  return (
    <main style={{ padding: 24 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--dpf-text)" }}>Exam Vouchers</h1>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
          Open Group exam voucher tracking. {vouchers.length} vouchers total.
        </p>
      </header>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
              {["Student", "Course", "OG ID", "Type", "Store Ref", "Expiry", "Status"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vouchers.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--dpf-muted)" }}>
                  No vouchers created yet. Vouchers are issued after course completion.
                </td>
              </tr>
            ) : (
              vouchers.map(v => {
                const statusColor =
                  v.status === "issued" ? "#4ade80" :
                  v.status === "used" ? "#93c5fd" :
                  v.status === "expired" ? "#ef4444" : "#fbbf24";
                return (
                  <tr key={v.id} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                    <td style={{ padding: "8px 10px", color: "var(--dpf-text)", fontWeight: 500 }}>
                      {v.registration.firstName} {v.registration.lastName}
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--dpf-muted)" }}>
                      {v.registration.instance.product.name}
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "var(--dpf-text)" }}>
                      {v.ogId ?? "-"}
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--dpf-muted)" }}>{v.voucherType ?? "-"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "var(--dpf-muted)", fontSize: 11 }}>
                      {v.ogStoreReference ?? "-"}
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--dpf-muted)" }}>
                      {v.voucherExpiry1
                        ? new Date(v.voucherExpiry1).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                        : "-"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: statusColor }}>{v.status}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
