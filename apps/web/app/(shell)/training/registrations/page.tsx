import { getAllRegistrations } from "@/lib/actions/training";

export default async function RegistrationsPage() {
  const registrations = await getAllRegistrations();

  return (
    <main style={{ padding: 24 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--dpf-text)" }}>Registrations</h1>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)" }}>{registrations.length} total registrations</p>
      </header>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
              {["Reg ID", "Student", "Email", "Company", "Country", "Course", "Job Code", "Fee (USD)", "Payment", "Voucher"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {registrations.map(r => {
              const payColor = r.paymentStatus === "paid" ? "#4ade80" : r.paymentStatus === "refunded" ? "#ef4444" : "#fbbf24";
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "var(--dpf-text)", fontSize: 11 }}>{r.registrationId}</td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-text)", fontWeight: 500 }}>{r.firstName} {r.lastName}</td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-muted)" }}>{r.email}</td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-muted)" }}>{r.company ?? "-"}</td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-muted)" }}>{r.country ?? "-"}</td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-text)" }}>{r.instance.product.name}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "var(--dpf-muted)", fontSize: 11 }}>{r.instance.jobCode}</td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-text)", textAlign: "right" }}>${Number(r.netFeeUsd).toLocaleString()}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: payColor }}>{r.paymentStatus}</span>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {r.examVoucher ? (
                      <span style={{
                        fontSize: 10,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: r.examVoucher.status === "issued" ? "#064e3b33" : "var(--dpf-surface-2, var(--dpf-surface-1))",
                        color: r.examVoucher.status === "issued" ? "#6ee7b7" : "var(--dpf-muted)",
                      }}>
                        {r.examVoucher.status}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
