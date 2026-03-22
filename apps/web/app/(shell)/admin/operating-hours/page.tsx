import { getOperatingHours, saveOperatingHours } from "@/lib/actions/operating-hours";
import { OperatingHoursEditor } from "@/components/admin/OperatingHoursEditor";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function OperatingHoursPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Smart defaults handled inside getOperatingHours (archetype > industry > fallback)
  const { schedule, timezone } = await getOperatingHours();

  async function handleSave(newSchedule: Parameters<typeof saveOperatingHours>[0]["schedule"]) {
    "use server";
    await saveOperatingHours({ schedule: newSchedule, timezone });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operating Hours</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Set your business operating hours. These determine when platform maintenance is scheduled
          and when your team is available for bookings.
        </p>
      </div>

      <OperatingHoursEditor
        defaultSchedule={schedule}
        timezone={timezone}
        onSave={handleSave}
      />
    </div>
  );
}
