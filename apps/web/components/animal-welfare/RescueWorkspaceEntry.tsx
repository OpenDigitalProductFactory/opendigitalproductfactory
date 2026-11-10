import Link from "next/link";
import { Surface } from "@/components/ui/Surface";

export function RescueWorkspaceEntry() {
  return (
    <Surface as="section" className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Pet Rescue</p>
        <h2 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">Animal welfare work, in one place</h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">Intake, housing, daily care, adoption, and stewardship share one animal identity.</p>
      </div>
      <Link
        href="/workspace/rescue"
        data-owner-first-next-action=""
        className="dpf-tap-target shrink-0 rounded border border-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-[var(--dpf-accent)] hover:bg-[color-mix(in_srgb,var(--dpf-accent)_10%,transparent)]"
      >
        Open rescue operations
      </Link>
    </Surface>
  );
}
