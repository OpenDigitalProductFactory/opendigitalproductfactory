import { getAllCourseInstances } from "@/lib/actions/training";

export default async function CourseSchedulePage() {
  const instances = await getAllCourseInstances();

  return (
    <main style={{ padding: 24 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--dpf-text)" }}>Course Schedule</h1>
      </header>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
              {["Job Code", "Course", "Start", "End", "Location", "Trainer", "Type", "Enrolled", "Price", "Status"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {instances.map(c => {
              const price = c.pricePerSeatUsd ?? c.product.standardPriceUsd;
              const statusColor = c.status === "completed" ? "#4ade80" : c.status === "cancelled" ? "#ef4444" : c.status === "in-progress" ? "#fbbf24" : "var(--dpf-muted)";
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "var(--dpf-text)" }}>{c.jobCode}</td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-text)", fontWeight: 500 }}>{c.product.name}</td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-muted)" }}>
                    {new Date(c.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-muted)" }}>
                    {new Date(c.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-muted)" }}>{c.location ?? "Virtual"}</td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-muted)" }}>{c.trainerName ?? "-"}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: c.isPublic ? "var(--dpf-surface-2, var(--dpf-surface-1))" : "#1e3a5f",
                      color: c.isPublic ? "var(--dpf-muted)" : "#93c5fd",
                    }}>
                      {c.isPublic ? "Public" : c.customerTag ?? "Corporate"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-text)" }}>
                    {c.currentEnrollment}/{c.maxSeats}
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--dpf-text)" }}>${Number(price).toLocaleString()}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: statusColor }}>{c.status}</span>
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
