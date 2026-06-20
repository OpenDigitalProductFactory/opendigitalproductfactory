import { getOperatingHours, saveOperatingHours } from "@/lib/actions/operating-hours";
import { OperatingHoursEditor } from "@/components/admin/OperatingHoursEditor";
import { getSetupContext } from "@/lib/actions/setup-progress";

export default async function StorefrontOperatingHoursPage() {
  const setupContext = await getSetupContext();

  const { schedule, timezone } = await getOperatingHours({
    suggestedTimezone: setupContext?.suggestedTimezone,
    suggestedIndustry: setupContext?.suggestedIndustry,
  });

  async function handleSave(
    newSchedule: Parameters<typeof saveOperatingHours>[0]["schedule"],
    newTimezone: string,
  ) {
    "use server";
    // Persist the timezone the operator selected in the editor — not the
    // render-time value — so a fresh install on the UTC placeholder can finally
    // pin its real zone (the maintenance/upgrade window depends on it).
    await saveOperatingHours({ schedule: newSchedule, timezone: newTimezone || timezone });
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
