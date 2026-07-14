import type { Metadata } from "next";

import { TwinKitShowcase } from "@/components/twin/TwinKitShowcase";

export const metadata: Metadata = {
  title: "Operational Twin Kit — preview",
};

// Fixture/reference surface for the Operational Twin grammar kit (P2). Not linked
// from the admin nav — it is a developer preview of the ten primitives, reachable
// directly at /admin/twin-kit and gated by the admin layout's view_admin guard.
// P3 replaces the hand-built prototypes with template compositions of this kit
// bound to a real TwinProfile + LivingBusinessSnapshot.
export default function AdminTwinKitPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operational Twin Kit</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Preview of the ten grammar primitives every twin composes from — shown on a
          physical floor and a non-physical board.
        </p>
      </div>
      <TwinKitShowcase />
    </div>
  );
}
