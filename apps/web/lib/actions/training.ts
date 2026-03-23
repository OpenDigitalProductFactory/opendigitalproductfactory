"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

// ─── Public queries (no auth) ────────────────────────────────────────────────

export async function getUpcomingPublicCourses() {
  return prisma.courseInstance.findMany({
    where: {
      isPublic: true,
      status: "scheduled",
      startDate: { gte: new Date() },
    },
    include: { product: true },
    orderBy: { startDate: "asc" },
  });
}

export async function getCourseByJobCode(jobCode: string) {
  return prisma.courseInstance.findUnique({
    where: { jobCode },
    include: { product: true, registrations: { select: { id: true } } },
  });
}

export async function registerForCourse(
  jobCode: string,
  data: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    company?: string;
    country?: string;
    role?: string;
  },
): Promise<{ ok: boolean; message: string; registrationId?: string }> {
  const instance = await prisma.courseInstance.findUnique({
    where: { jobCode },
    include: { product: true },
  });
  if (!instance) return { ok: false, message: "Course not found" };
  if (instance.status !== "scheduled") return { ok: false, message: "Course is not open for registration" };
  if (instance.currentEnrollment >= instance.maxSeats) return { ok: false, message: "Course is full" };

  // Check duplicate
  const existing = await prisma.courseRegistration.findFirst({
    where: { courseInstanceId: instance.id, email: data.email },
  });
  if (existing) return { ok: false, message: "You are already registered for this course" };

  const regNum = Math.random().toString(36).substring(2, 8).toUpperCase();
  const registrationId = `REG-${regNum}`;
  const price = instance.pricePerSeatUsd ?? instance.product.standardPriceUsd;

  await prisma.$transaction([
    prisma.courseRegistration.create({
      data: {
        registrationId,
        courseInstanceId: instance.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone ?? null,
        company: data.company ?? null,
        country: data.country ?? null,
        role: data.role ?? null,
        netFeeUsd: price,
      },
    }),
    prisma.courseInstance.update({
      where: { id: instance.id },
      data: { currentEnrollment: { increment: 1 } },
    }),
  ]);

  return { ok: true, message: "Registration successful", registrationId };
}

// ─── Admin queries ───────────────────────────────────────────────────────────

export async function getAllCourseProducts() {
  return prisma.courseProduct.findMany({ orderBy: { name: "asc" } });
}

export async function getAllCourseInstances() {
  return prisma.courseInstance.findMany({
    include: { product: true, _count: { select: { registrations: true } } },
    orderBy: { startDate: "desc" },
  });
}

export async function getRegistrationsForInstance(instanceId: string) {
  return prisma.courseRegistration.findMany({
    where: { courseInstanceId: instanceId },
    include: { examVoucher: true, instance: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAllRegistrations() {
  return prisma.courseRegistration.findMany({
    include: {
      examVoucher: true,
      instance: { include: { product: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAllVouchers() {
  return prisma.examVoucher.findMany({
    include: {
      registration: {
        include: { instance: { include: { product: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateVoucher(
  voucherId: string,
  data: { ogId?: string; voucherType?: string; ogStoreReference?: string; status?: string },
): Promise<{ ok: boolean; message: string }> {
  await prisma.examVoucher.update({ where: { id: voucherId }, data });
  revalidatePath("/training/vouchers");
  return { ok: true, message: "Voucher updated" };
}

export async function createVoucherForRegistration(
  registrationId: string,
): Promise<{ ok: boolean; message: string }> {
  const existing = await prisma.examVoucher.findUnique({ where: { registrationId } });
  if (existing) return { ok: false, message: "Voucher already exists" };
  await prisma.examVoucher.create({ data: { registrationId } });
  revalidatePath("/training/vouchers");
  return { ok: true, message: "Voucher created" };
}

export async function getTrainingDashboardStats() {
  const [products, instances, registrations, vouchers] = await Promise.all([
    prisma.courseProduct.count({ where: { isActive: true } }),
    prisma.courseInstance.count({ where: { status: "scheduled" } }),
    prisma.courseRegistration.count(),
    prisma.examVoucher.count({ where: { status: { not: "expired" } } }),
  ]);
  return { products, scheduledInstances: instances, totalRegistrations: registrations, activeVouchers: vouchers };
}
