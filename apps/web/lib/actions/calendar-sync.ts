// apps/web/lib/actions/calendar-sync.ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { parseICal } from "@/lib/ical-parser";
import * as crypto from "crypto";

// ─── Add iCal subscription ──────────────────────────────────────────────────

export async function addICalSubscription(input: {
  feedUrl: string;
  name?: string;
}): Promise<{ success: boolean; syncId?: string; imported?: number; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const profile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return { success: false, error: "Employee profile not found" };

  // Validate URL
  let url: URL;
  try {
    url = new URL(input.feedUrl);
  } catch {
    return { success: false, error: "Invalid URL" };
  }

  // Check for duplicate
  const existing = await prisma.calendarSync.findUnique({
    where: {
      employeeProfileId_provider: {
        employeeProfileId: profile.id,
        provider: "ical",
      },
    },
  });

  const syncId = existing?.syncId ?? `SYNC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  // Fetch and parse the feed
  let icsContent: string;
  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "DPF-Calendar/1.0" },
    });
    if (!res.ok) return { success: false, error: `Feed returned ${res.status}` };
    icsContent = await res.text();
  } catch (e) {
    return { success: false, error: `Could not fetch feed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const events = parseICal(icsContent);
  if (events.length === 0) {
    return { success: false, error: "No events found in feed. Check the URL is a valid .ics feed." };
  }

  // Upsert the sync record
  await prisma.calendarSync.upsert({
    where: {
      employeeProfileId_provider: {
        employeeProfileId: profile.id,
        provider: "ical",
      },
    },
    create: {
      syncId,
      employeeProfileId: profile.id,
      provider: "ical",
      connectionData: { feedUrl: url.toString(), name: input.name ?? url.hostname },
      syncDirection: "inbound",
      lastSyncAt: new Date(),
    },
    update: {
      connectionData: { feedUrl: url.toString(), name: input.name ?? url.hostname },
      lastSyncAt: new Date(),
      status: "active",
      errorMessage: null,
    },
  });

  // Upsert events
  let imported = 0;
  for (const event of events) {
    const eventId = `ical-${crypto.createHash("md5").update(event.uid).digest("hex").slice(0, 12)}`;

    await prisma.calendarEvent.upsert({
      where: { eventId },
      create: {
        eventId,
        title: event.summary,
        description: event.description,
        startAt: event.dtStart,
        endAt: event.dtEnd,
        allDay: event.allDay,
        eventType: "synced",
        category: "external",
        ownerEmployeeId: profile.id,
        visibility: "private",
        syncSource: "ical",
        externalId: event.uid,
      },
      update: {
        title: event.summary,
        description: event.description,
        startAt: event.dtStart,
        endAt: event.dtEnd,
        allDay: event.allDay,
      },
    });
    imported++;
  }

  revalidatePath("/workspace");
  return { success: true, syncId, imported };
}

// ─── Refresh an existing iCal subscription ───────────────────────────────────

export async function refreshICalSubscription(): Promise<{ success: boolean; imported?: number; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const profile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return { success: false, error: "Employee profile not found" };

  const sync = await prisma.calendarSync.findUnique({
    where: {
      employeeProfileId_provider: {
        employeeProfileId: profile.id,
        provider: "ical",
      },
    },
  });
  if (!sync) return { success: false, error: "No iCal subscription found" };

  const connData = sync.connectionData as { feedUrl?: string };
  if (!connData.feedUrl) return { success: false, error: "No feed URL configured" };

  // Re-use addICalSubscription logic
  return addICalSubscription({ feedUrl: connData.feedUrl });
}

// ─── Remove iCal subscription ────────────────────────────────────────────────

export async function removeICalSubscription(): Promise<{ success: boolean; removed?: number; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const profile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return { success: false, error: "Employee profile not found" };

  // Delete synced events
  const deleted = await prisma.calendarEvent.deleteMany({
    where: {
      ownerEmployeeId: profile.id,
      syncSource: "ical",
    },
  });

  // Delete sync record
  await prisma.calendarSync.deleteMany({
    where: {
      employeeProfileId: profile.id,
      provider: "ical",
    },
  });

  revalidatePath("/workspace");
  return { success: true, removed: deleted.count };
}

// ─── Get sync status ─────────────────────────────────────────────────────────

export async function getICalSyncStatus(): Promise<{
  connected: boolean;
  feedUrl: string | null;
  name: string | null;
  lastSyncAt: string | null;
  eventCount: number;
} | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const profile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return null;

  const sync = await prisma.calendarSync.findUnique({
    where: {
      employeeProfileId_provider: {
        employeeProfileId: profile.id,
        provider: "ical",
      },
    },
  });
  if (!sync) return { connected: false, feedUrl: null, name: null, lastSyncAt: null, eventCount: 0 };

  const connData = sync.connectionData as { feedUrl?: string; name?: string };
  const eventCount = await prisma.calendarEvent.count({
    where: { ownerEmployeeId: profile.id, syncSource: "ical" },
  });

  return {
    connected: true,
    feedUrl: connData.feedUrl ?? null,
    name: connData.name ?? null,
    lastSyncAt: sync.lastSyncAt?.toISOString() ?? null,
    eventCount,
  };
}
