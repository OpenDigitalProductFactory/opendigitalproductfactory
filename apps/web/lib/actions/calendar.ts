// apps/web/lib/actions/calendar.ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import * as crypto from "crypto";

export async function createCalendarEvent(input: {
  title: string;
  description?: string;
  startAt: string;
  endAt?: string;
  allDay?: boolean;
  eventType?: string;
  category?: string;
  visibility?: string;
  recurrence?: string;
  color?: string;
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const profile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return { success: false, error: "Employee profile not found" };

  const eventId = `CE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.calendarEvent.create({
    data: {
      eventId,
      title: input.title,
      description: input.description ?? null,
      startAt: new Date(input.startAt),
      endAt: input.endAt ? new Date(input.endAt) : null,
      allDay: input.allDay ?? false,
      eventType: input.eventType ?? "personal",
      category: input.category ?? "personal",
      ownerEmployeeId: profile.id,
      visibility: input.visibility ?? "team",
      recurrence: input.recurrence ?? null,
      color: input.color ?? null,
    },
  });

  revalidatePath("/workspace");
  return { success: true, eventId };
}

export async function updateCalendarEvent(
  eventId: string,
  input: {
    title?: string;
    description?: string;
    startAt?: string;
    endAt?: string;
    allDay?: boolean;
    color?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const event = await prisma.calendarEvent.findUnique({ where: { eventId } });
  if (!event) return { success: false, error: "Event not found" };
  if (event.syncSource) return { success: false, error: "Cannot edit synced events" };

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data["title"] = input.title;
  if (input.description !== undefined) data["description"] = input.description;
  if (input.startAt !== undefined) data["startAt"] = new Date(input.startAt);
  if (input.endAt !== undefined) data["endAt"] = input.endAt ? new Date(input.endAt) : null;
  if (input.allDay !== undefined) data["allDay"] = input.allDay;
  if (input.color !== undefined) data["color"] = input.color;

  await prisma.calendarEvent.update({ where: { eventId }, data });

  revalidatePath("/workspace");
  return { success: true };
}

export async function deleteCalendarEvent(
  eventId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const event = await prisma.calendarEvent.findUnique({ where: { eventId } });
  if (!event) return { success: false, error: "Event not found" };
  if (event.syncSource) return { success: false, error: "Cannot delete synced events" };

  await prisma.calendarEvent.delete({ where: { eventId } });

  revalidatePath("/workspace");
  return { success: true };
}
