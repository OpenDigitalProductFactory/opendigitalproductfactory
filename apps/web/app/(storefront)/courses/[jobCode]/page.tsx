import { notFound } from "next/navigation";
import { getCourseByJobCode } from "@/lib/actions/training";
import { RegistrationForm } from "./registration-form";
import Link from "next/link";

type Props = { params: Promise<{ jobCode: string }> };

export default async function CourseDetailPage({ params }: Props) {
  const { jobCode } = await params;
  const course = await getCourseByJobCode(jobCode);
  if (!course) notFound();

  const price = course.pricePerSeatUsd ?? course.product.standardPriceUsd;
  const spotsLeft = course.maxSeats - course.currentEnrollment;
  const isFull = spotsLeft <= 0;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px" }}>
      <Link href="/courses" style={{ fontSize: 12, color: "var(--dpf-muted)", textDecoration: "none" }}>
        &larr; Back to courses
      </Link>

      <header style={{ marginTop: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--dpf-text)" }}>
          {course.product.name}
        </h1>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginTop: 4 }}>
          {course.product.certificationBody} &middot; {course.product.durationDays} days
        </p>
        {course.product.description && (
          <p style={{ fontSize: 14, color: "var(--dpf-text)", marginTop: 12, lineHeight: 1.6 }}>
            {course.product.description}
          </p>
        )}
      </header>

      <section style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
        padding: 20,
        borderRadius: 8,
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        marginBottom: 24,
      }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Dates</div>
          <div style={{ fontSize: 14, color: "var(--dpf-text)", marginTop: 4 }}>
            {new Date(course.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            {" - "}
            {new Date(course.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Location</div>
          <div style={{ fontSize: 14, color: "var(--dpf-text)", marginTop: 4 }}>{course.location ?? "Virtual"}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Price</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-accent)", marginTop: 4 }}>
            ${Number(price).toLocaleString()} USD
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Availability</div>
          <div style={{ fontSize: 14, color: isFull ? "#ef4444" : "var(--dpf-text)", marginTop: 4, fontWeight: 600 }}>
            {isFull ? "Course Full" : `${spotsLeft} spots remaining`}
          </div>
        </div>
        {course.trainerName && (
          <div>
            <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Trainer</div>
            <div style={{ fontSize: 14, color: "var(--dpf-text)", marginTop: 4 }}>{course.trainerName}</div>
          </div>
        )}
      </section>

      {isFull ? (
        <div style={{ padding: 20, background: "var(--dpf-surface-1)", borderRadius: 8, textAlign: "center" }}>
          <p style={{ color: "var(--dpf-muted)" }}>This course is fully booked. Please check other available dates.</p>
        </div>
      ) : (
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 16 }}>
            Register for this course
          </h2>
          <RegistrationForm jobCode={jobCode} />
        </section>
      )}
    </main>
  );
}
