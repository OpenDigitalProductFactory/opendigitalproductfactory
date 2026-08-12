import Link from "next/link";

export function CoworkerActivityInspectionLink({ surface }: { surface: string }) {
  if (surface !== "coworker.reasoning-loop") return null;

  return (
    <Link
      href="/platform/ai/right-now"
      className="ml-3.5 inline-flex min-h-11 items-center text-xs font-medium text-[var(--dpf-accent)] hover:underline"
    >
      Inspect AI workforce activity
    </Link>
  );
}
