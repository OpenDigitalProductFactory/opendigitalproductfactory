import { getOperatingHours, saveOperatingHours } from "@/lib/actions/operating-hours";
import { OperatingHoursEditor } from "@/components/admin/OperatingHoursEditor";
import { getSetupContext } from "@/lib/actions/setup-progress";

export default async function StorefrontOperatingHoursPage() {
  const setupContext = await getSetupContext();

  const { schedule, timezone } = await getOperatingHours({
    suggestedTimezone: setupContext?.suggestedTimezone,
    suggestedIndustry: setupContext?.suggestedIndustry,
  });

  async function handleSave(newSchedule: Parameters<typeof saveOperatingHours>[0]["schedule"]) {
    "use server";
    await saveOperatingHours({ schedule: newSchedule, timezone });
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--dpf-text)]">Operating Hours</h2>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Set when your business is open so bookings, availability, and maintenance windows stay aligned.
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
