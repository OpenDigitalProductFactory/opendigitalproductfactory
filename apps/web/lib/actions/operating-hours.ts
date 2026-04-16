"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { GENERIC_DEFAULTS } from "@/lib/operating-hours-types";
import type { DaySchedule, WeeklySchedule } from "@/lib/operating-hours-types";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
type DayName = (typeof DAY_NAMES)[number];

const CLOSED_DAY: DaySchedule = { enabled: false, open: "09:00", close: "17:00" };

// ─── Auth Guard ──────────────────────────────────────────────────────────────

async function requireAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new Error("Unauthorized");
  // Any authenticated user can view/set operating hours during setup
  return user.id!;
}

// ─── Helpers: BusinessProfile JSON <-> WeeklySchedule ────────────────────────

function profileHoursToSchedule(
  businessHours: Record<string, { open: string; close: string } | null>
): WeeklySchedule {
  const schedule = { ...GENERIC_DEFAULTS };
  for (const day of DAY_NAMES) {
    const hours = businessHours[day];
    if (hours) {
      schedule[day] = { enabled: true, open: hours.open, close: hours.close };
    } else {
      schedule[day] = { ...CLOSED_DAY };
    }
  }
  return schedule;
}

function scheduleToProfileHours(
  schedule: WeeklySchedule
): Record<string, { open: string; close: string } | null> {
  const hours: Record<string, { open: string; close: string } | null> = {};
  for (const day of DAY_NAMES) {
    const d = schedule[day];
    hours[day] = d.enabled ? { open: d.open, close: d.close } : null;
  }
  return hours;
}

// ─── Helpers: Low-traffic windows derivation ──────────────────────────────

function deriveLowTrafficWindows(
  schedule: WeeklySchedule
): Array<{ dayOfWeek: number; start: string; end: string }> {
  const windows: Array<{ dayOfWeek: number; start: string; end: string }> = [];

  for (let i = 0; i < DAY_NAMES.length; i++) {
    const day = DAY_NAMES[i];
    const d = schedule[day];

    if (!d.enabled) {
      // Closed day — entire day is low traffic
      windows.push({ dayOfWeek: i, start: "00:00", end: "23:59" });
    } else {
      // Before open
      if (d.open !== "00:00") {
        windows.push({ dayOfWeek: i, start: "00:00", end: d.open });
      }
      // After close
      if (d.close !== "23:59") {
        windows.push({ dayOfWeek: i, start: d.close, end: "23:59" });
      }
    }
  }
  return windows;
}

// ─── Helpers: Deployment windows from schedule ───────────────────────────

type DeploymentWindowData = {
  businessProfileId: string;
  windowKey: string;
  name: string;
  description: string;
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
  maxConcurrentChanges: number;
  allowedChangeTypes: string[];
  allowedRiskLevels: string[];
  enforcement: string;
};

function deriveDeploymentWindows(
  schedule: WeeklySchedule,
  profileId: string
): DeploymentWindowData[] {
  const defaults = {
    maxConcurrentChanges: 1,
    allowedChangeTypes: ["standard", "normal"],
    allowedRiskLevels: ["low", "medium"],
    enforcement: "advisory",
  };

  // Group open days by identical close/open times (their off-hours pattern)
  const overnightGroups = new Map<string, number[]>();
  const allDayDays: number[] = [];

  for (let i = 0; i < DAY_NAMES.length; i++) {
    const day = DAY_NAMES[i];
    const d = schedule[day];
    if (!d.enabled) {
      allDayDays.push(i);
    } else {
      const key = `${d.close}|${d.open}`;
      if (!overnightGroups.has(key)) overnightGroups.set(key, []);
      overnightGroups.get(key)!.push(i);
    }
  }

  const windows: DeploymentWindowData[] = [];
  let idx = 0;

  for (const [key, days] of overnightGroups) {
    const [startTime, endTime] = key.split("|");
    const suffix = idx === 0 ? "business-days" : `business-days-${idx}`;
    windows.push({
      businessProfileId: profileId,
      windowKey: `off-hours-${suffix}`,
      name: `Off-Hours (Business Days${idx > 0 ? ` #${idx + 1}` : ""})`,
      description: "Automatically derived from operating hours — outside business hours on open days",
      dayOfWeek: days,
      startTime: startTime ?? "17:00",
      endTime: endTime ?? "09:00",
      ...defaults,
    });
    idx++;
  }

  if (allDayDays.length > 0) {
    windows.push({
      businessProfileId: profileId,
      windowKey: "off-hours-closed-days",
      name: "Off-Hours (Closed Days)",
      description: "Automatically derived from operating hours — all day on closed days",
      dayOfWeek: allDayDays,
      startTime: "00:00",
      endTime: "23:59",
      ...defaults,
      allowedChangeTypes: ["standard", "normal", "emergency"],
      allowedRiskLevels: ["low", "medium", "high", "critical"],
    });
  }

  return windows;
}

// ─── getOperatingHours ───────────────────────────────────────────────────

export async function getOperatingHours(opts?: {
  suggestedTimezone?: string;
  suggestedIndustry?: string;
}): Promise<{
  schedule: WeeklySchedule;
  timezone: string;
  isConfirmed: boolean;
}> {
  await requireAccess();

  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    select: { businessHours: true, timezone: true, hoursConfirmedAt: true },
  });

  // Resolve timezone: confirmed profile > suggested from URL import > UTC fallback
  const resolvedTimezone = profile?.timezone && profile.timezone !== "UTC"
    ? profile.timezone
    : opts?.suggestedTimezone ?? profile?.timezone ?? "UTC";

  // Priority 1: Existing confirmed hours
  if (profile?.hoursConfirmedAt) {
    const businessHours = profile.businessHours as Record<string, { open: string; close: string } | null>;
    return {
      schedule: profileHoursToSchedule(businessHours),
      timezone: resolvedTimezone,
      isConfirmed: true,
    };
  }

  // Priority 2/3: Smart defaults from archetype/industry
  const config = await prisma.storefrontConfig.findFirst({
    select: { archetypeId: true },
  });
  const archetypeCategory = config?.archetypeId?.split("/")[0];
  // Use storefront archetype if available, otherwise fall back to suggested industry from URL
  const categoryForDefaults = archetypeCategory ?? opts?.suggestedIndustry;

  if (categoryForDefaults) {
    return {
      schedule: await getDefaultHoursForArchetype(categoryForDefaults),
      timezone: resolvedTimezone,
      isConfirmed: false,
    };
  }

  // Priority 4: Generic fallback
  return {
    schedule: { ...GENERIC_DEFAULTS },
    timezone: resolvedTimezone,
    isConfirmed: false,
  };
}

// ─── getDefaultHoursForArchetype ──────────────────────────────────────────

const INDUSTRY_DEFAULTS: Record<string, WeeklySchedule> = {
  "healthcare-wellness": {
    monday:    { enabled: true, open: "08:00", close: "17:00" },
    tuesday:   { enabled: true, open: "08:00", close: "17:00" },
    wednesday: { enabled: true, open: "08:00", close: "17:00" },
    thursday:  { enabled: true, open: "08:00", close: "17:00" },
    friday:    { enabled: true, open: "08:00", close: "17:00" },
    saturday:  { enabled: false, open: "09:00", close: "13:00" },
    sunday:    { enabled: false, open: "09:00", close: "17:00" },
  },
  "beauty-personal-care": {
    monday:    { enabled: true, open: "09:00", close: "18:00" },
    tuesday:   { enabled: true, open: "09:00", close: "18:00" },
    wednesday: { enabled: true, open: "09:00", close: "18:00" },
    thursday:  { enabled: true, open: "09:00", close: "18:00" },
    friday:    { enabled: true, open: "09:00", close: "18:00" },
    saturday:  { enabled: true, open: "09:00", close: "17:00" },
    sunday:    { enabled: false, open: "09:00", close: "17:00" },
  },
  "retail-goods": {
    monday:    { enabled: true, open: "09:00", close: "18:00" },
    tuesday:   { enabled: true, open: "09:00", close: "18:00" },
    wednesday: { enabled: true, open: "09:00", close: "18:00" },
    thursday:  { enabled: true, open: "09:00", close: "18:00" },
    friday:    { enabled: true, open: "09:00", close: "18:00" },
    saturday:  { enabled: true, open: "09:00", close: "18:00" },
    sunday:    { enabled: true, open: "10:00", close: "16:00" },
  },
  "food-hospitality": {
    monday:    { enabled: true, open: "09:00", close: "18:00" },
    tuesday:   { enabled: true, open: "09:00", close: "18:00" },
    wednesday: { enabled: true, open: "09:00", close: "18:00" },
    thursday:  { enabled: true, open: "09:00", close: "18:00" },
    friday:    { enabled: true, open: "09:00", close: "18:00" },
    saturday:  { enabled: true, open: "09:00", close: "18:00" },
    sunday:    { enabled: true, open: "10:00", close: "16:00" },
  },
  "professional-services": { ...GENERIC_DEFAULTS },
  "trades-maintenance": {
    monday:    { enabled: true, open: "07:00", close: "16:00" },
    tuesday:   { enabled: true, open: "07:00", close: "16:00" },
    wednesday: { enabled: true, open: "07:00", close: "16:00" },
    thursday:  { enabled: true, open: "07:00", close: "16:00" },
    friday:    { enabled: true, open: "07:00", close: "16:00" },
    saturday:  { enabled: false, open: "07:00", close: "16:00" },
    sunday:    { enabled: false, open: "07:00", close: "16:00" },
  },
  "fitness-recreation": {
    monday:    { enabled: true, open: "06:00", close: "21:00" },
    tuesday:   { enabled: true, open: "06:00", close: "21:00" },
    wednesday: { enabled: true, open: "06:00", close: "21:00" },
    thursday:  { enabled: true, open: "06:00", close: "21:00" },
    friday:    { enabled: true, open: "06:00", close: "21:00" },
    saturday:  { enabled: true, open: "08:00", close: "18:00" },
    sunday:    { enabled: true, open: "08:00", close: "18:00" },
  },
  "education-training": {
    monday:    { enabled: true, open: "08:30", close: "17:00" },
    tuesday:   { enabled: true, open: "08:30", close: "17:00" },
    wednesday: { enabled: true, open: "08:30", close: "17:00" },
    thursday:  { enabled: true, open: "08:30", close: "17:00" },
    friday:    { enabled: true, open: "08:30", close: "17:00" },
    saturday:  { enabled: false, open: "08:30", close: "17:00" },
    sunday:    { enabled: false, open: "08:30", close: "17:00" },
  },
  "pet-services": {
    monday:    { enabled: true, open: "08:00", close: "18:00" },
    tuesday:   { enabled: true, open: "08:00", close: "18:00" },
    wednesday: { enabled: true, open: "08:00", close: "18:00" },
    thursday:  { enabled: true, open: "08:00", close: "18:00" },
    friday:    { enabled: true, open: "08:00", close: "18:00" },
    saturday:  { enabled: true, open: "09:00", close: "14:00" },
    sunday:    { enabled: false, open: "09:00", close: "14:00" },
  },
};

export async function getDefaultHoursForArchetype(
  archetypeCategory?: string | null
): Promise<WeeklySchedule> {
  if (archetypeCategory && INDUSTRY_DEFAULTS[archetypeCategory]) {
    return { ...INDUSTRY_DEFAULTS[archetypeCategory] };
  }
  return { ...GENERIC_DEFAULTS };
}

// ─── saveOperatingHours ──────────────────────────────────────────────────

export async function saveOperatingHours(input: {
  schedule: WeeklySchedule;
  timezone?: string;
  hasStorefront?: boolean;
}): Promise<void> {
  await requireAccess();

  const { schedule, timezone, hasStorefront } = input;

  // Validate: at least one day enabled
  const anyEnabled = DAY_NAMES.some((day) => schedule[day].enabled);
  if (!anyEnabled) throw new Error("At least one day must be enabled");

  // Validate: end after start for enabled days
  for (const day of DAY_NAMES) {
    const d = schedule[day];
    if (d.enabled && d.close <= d.open) {
      throw new Error(`${day}: closing time must be after opening time`);
    }
  }

  const businessHours = scheduleToProfileHours(schedule);
  const lowTrafficWindows = deriveLowTrafficWindows(schedule);

  await prisma.$transaction(async (tx) => {
    // 1. Upsert BusinessProfile
    const profile = await tx.businessProfile.upsert({
      where: { profileKey: "default" },
      create: {
        profileKey: "default",
        name: "Default Business Profile",
        isActive: true,
        businessHours: businessHours as never,
        timezone: timezone ?? "UTC",
        hasStorefront: hasStorefront ?? false,
        lowTrafficWindows: lowTrafficWindows as never,
        hoursConfirmedAt: new Date(),
      },
      update: {
        businessHours: businessHours as never,
        ...(timezone ? { timezone } : {}),
        ...(hasStorefront !== undefined ? { hasStorefront } : {}),
        lowTrafficWindows: lowTrafficWindows as never,
        hoursConfirmedAt: new Date(),
      },
    });

    // 2. Replace seed/derived deployment windows
    // Delete windows with off-hours-* prefix OR the old seed keys
    await tx.deploymentWindow.deleteMany({
      where: {
        businessProfileId: profile.id,
        OR: [
          { windowKey: { startsWith: "off-hours-" } },
          { windowKey: { in: ["weeknight-maintenance", "weekend-maintenance"] } },
        ],
      },
    });

    // Create new windows derived from hours
    const newWindows = deriveDeploymentWindows(schedule, profile.id);
    if (newWindows.length > 0) {
      await tx.deploymentWindow.createMany({ data: newWindows });
    }

    // 3. Optionally seed ProviderAvailability if a ServiceProvider exists
    const provider = await tx.serviceProvider.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    if (provider) {
      // Delete existing availability for this provider
      await tx.providerAvailability.deleteMany({
        where: { providerId: provider.id },
      });

      // Group days by identical hours
      const grouped = new Map<string, number[]>();
      for (let i = 0; i < DAY_NAMES.length; i++) {
        const d = schedule[DAY_NAMES[i]];
        if (!d.enabled) continue;
        const key = `${d.open}|${d.close}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(i);
      }

      const availabilityRows = Array.from(grouped.entries()).map(([key, days]) => {
        const [startTime, endTime] = key.split("|");
        return {
          providerId: provider.id,
          days,
          startTime: startTime ?? "09:00",
          endTime: endTime ?? "17:00",
        };
      });

      if (availabilityRows.length > 0) {
        await tx.providerAvailability.createMany({ data: availabilityRows });
      }
    }
  });

  revalidatePath("/ops");
  revalidatePath("/admin");
}
