import Link from "next/link";
import { getTrainingDashboardStats, getAllCourseInstances, getAllRegistrations, getAllVouchers } from "@/lib/actions/training";

export default async function TrainingDashboardPage() {
  const [stats, instances, registrations, vouchers] = await Promise.all([
    getTrainingDashboardStats(),
    getAllCourseInstances(),
    getAllRegistrations(),
    getAllVouchers(),
  ]);

  const upcomingCourses = instances.filter(i => i.status === "scheduled").slice(0, 5);
  const recentRegistrations = registrations.slice(0, 5);

  // Calculate total revenue
  const totalRevenue = registrations
    .filter(r => r.paymentStatus === "paid")
    .reduce((sum, r) => sum + Number(r.netFeeUsd), 0);

  return (
    <main style={{ padding: 24 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--dpf-text)" }}>Training Management</h1>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginTop: 4 }}>
          Course scheduling, student registrations, and Open Group exam vouchers
        </p>
      </header>

      {/* Stats */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Course Products", value: stats.products },
          { label: "Scheduled Courses", value: stats.scheduledInstances },
          { label: "Total Registrations", value: stats.totalRegistrations },
          { label: "Active Vouchers", value: stats.activeVouchers },
        ].map(s => (
          <div key={s.label} style={{
            padding: 16,
            borderRadius: 8,
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-1)",
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--dpf-text)" }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </section>

      {/* Quick nav */}
      <nav style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {[
          { href: "/training/courses", label: "Course Schedule" },
          { href: "/training/registrations", label: "Registrations" },
          { href: "/training/vouchers", label: "Vouchers" },
          { href: "/courses", label: "Public Catalog", external: true },
        ].map(n => (
          <Link
            key={n.href}
            href={n.href}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              borderRadius: 6,
              border: "1px solid var(--dpf-border)",
              color: "var(--dpf-text)",
              textDecoration: "none",
              background: "var(--dpf-surface-1)",
            }}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Upcoming courses */}
        <section style={{
          padding: 16,
          borderRadius: 8,
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-surface-1)",
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 12 }}>
            Upcoming Courses
          </h2>
          {upcomingCourses.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--dpf-muted)" }}>No upcoming courses scheduled</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {upcomingCourses.map(c => (
                <div key={c.id} style={{
                  padding: 10,
                  borderRadius: 6,
                  background: "var(--dpf-surface-2, var(--dpf-surface-1))",
                  borderLeft: "3px solid var(--dpf-accent)",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)" }}>{c.product.name}</div>
                  <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
                    {new Date(c.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    {" "}&middot;{" "}{c.location ?? "Virtual"}
                    {" "}&middot;{" "}{c.currentEnrollment}/{c.maxSeats} enrolled
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent registrations */}
        <section style={{
          padding: 16,
          borderRadius: 8,
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-surface-1)",
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 12 }}>
            Recent Registrations
          </h2>
          {recentRegistrations.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--dpf-muted)" }}>No registrations yet</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {recentRegistrations.map(r => (
                <div key={r.id} style={{
                  padding: 10,
                  borderRadius: 6,
                  background: "var(--dpf-surface-2, var(--dpf-surface-1))",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)" }}>
                    {r.firstName} {r.lastName}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
                    {r.instance.product.name} &middot; {r.company ?? "Individual"} &middot;{" "}
                    <span style={{ color: r.paymentStatus === "paid" ? "#4ade80" : "#fbbf24" }}>
                      {r.paymentStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Revenue summary */}
      <section style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 8,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
      }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 8 }}>Revenue Summary</h2>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--dpf-accent)" }}>
          ${totalRevenue.toLocaleString()} USD
        </div>
        <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>Total paid registrations</div>
      </section>
    </main>
  );
}
