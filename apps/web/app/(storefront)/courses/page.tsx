import Link from "next/link";
import { getUpcomingPublicCourses } from "@/lib/actions/training";

export const metadata = { title: "Training Courses | AGL Technology" };

export default async function CourseCatalogPage() {
  const courses = await getUpcomingPublicCourses();

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 20px" }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--dpf-text)" }}>
          Upcoming Training Courses
        </h1>
        <p style={{ fontSize: 14, color: "var(--dpf-muted)", marginTop: 8 }}>
          Open Group certification courses delivered by AGL Technology. Register online to secure your place.
        </p>
      </header>

      {courses.length === 0 ? (
        <p style={{ color: "var(--dpf-muted)", padding: 40, textAlign: "center" }}>
          No upcoming courses at this time. Check back soon.
        </p>
      ) : (
        <section style={{ display: "grid", gap: 16 }}>
          {courses.map((c) => {
            const price = c.pricePerSeatUsd ?? c.product.standardPriceUsd;
            const spotsLeft = c.maxSeats - c.currentEnrollment;
            return (
              <Link
                key={c.id}
                href={`/courses/${c.jobCode}`}
                style={{
                  display: "block",
                  padding: 20,
                  borderRadius: 8,
                  border: "1px solid var(--dpf-border)",
                  background: "var(--dpf-surface-1)",
                  textDecoration: "none",
                  transition: "border-color 0.15s",
                }}
              >
                <article>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--dpf-text)", margin: 0 }}>
                        {c.product.name}
                      </h2>
                      <p style={{ fontSize: 12, color: "var(--dpf-muted)", marginTop: 4 }}>
                        {c.product.certificationBody} &middot; {c.product.durationDays} days
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--dpf-accent)" }}>
                        ${Number(price).toLocaleString()}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>per seat (USD)</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 13, color: "var(--dpf-muted)" }}>
                    <span>
                      {new Date(c.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      {" - "}
                      {new Date(c.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    <span>{c.location ?? "Virtual"}</span>
                    <span>{c.trainerName && `Trainer: ${c.trainerName}`}</span>
                    <span style={{ marginLeft: "auto", fontWeight: 600, color: spotsLeft <= 3 ? "#ef4444" : "var(--dpf-muted)" }}>
                      {spotsLeft} {spotsLeft === 1 ? "spot" : "spots"} left
                    </span>
                  </div>
                </article>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
