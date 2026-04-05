export function StalenessIndicator({
  lastReviewedAt,
  createdAt,
  reviewIntervalDays,
}: {
  lastReviewedAt: Date | null;
  createdAt: Date;
  reviewIntervalDays: number;
}) {
  const baseline = lastReviewedAt ?? createdAt;
  const dueDate = new Date(baseline.getTime() + reviewIntervalDays * 86400000);
  const now = new Date();

  if (now <= dueDate) return null;

  const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / 86400000);

  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap font-medium"
      style={{ backgroundColor: "color-mix(in srgb, var(--dpf-warning) 13%, transparent)", color: "var(--dpf-warning)" }}
      title={`${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue for review`}
    >
      Review needed
    </span>
  );
}
