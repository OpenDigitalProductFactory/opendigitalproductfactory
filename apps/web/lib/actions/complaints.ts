"use server";

import { prisma } from "@dpf/db";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

export type ComplaintSeverity = "low" | "medium" | "high" | "critical";
export type ComplaintStatus = "open" | "investigating" | "resolved" | "closed";

export type ComplaintView = {
  id: string; // human reference, e.g. C-AB12CD34
  customerName: string;
  description: string;
  severity: ComplaintSeverity;
  category: string;
  status: ComplaintStatus;
  createdAt: string; // ISO
};

const SEVERITIES: ComplaintSeverity[] = ["low", "medium", "high", "critical"];
const CATEGORIES = ["Billing", "Product", "Account", "Performance", "Data", "Other"];

function toView(row: {
  reference: string;
  customerName: string;
  description: string;
  severity: string;
  category: string;
  status: string;
  createdAt: Date;
}): ComplaintView {
  return {
    id: row.reference,
    customerName: row.customerName,
    description: row.description,
    severity: (SEVERITIES.includes(row.severity as ComplaintSeverity)
      ? row.severity
      : "medium") as ComplaintSeverity,
    category: row.category,
    status: (["open", "investigating", "resolved", "closed"].includes(row.status)
      ? row.status
      : "open") as ComplaintStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Live complaint register, newest first. */
export async function listComplaints(): Promise<ComplaintView[]> {
  const rows = await prisma.complaint.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      reference: true,
      customerName: true,
      description: true,
      severity: true,
      category: true,
      status: true,
      createdAt: true,
    },
  });
  return rows.map(toView);
}

export type CreateComplaintResult =
  | { success: true; complaint: ComplaintView }
  | { success: false; error: string };

/** Persist a new complaint and return the stored record. */
export async function createComplaint(input: {
  customerName: string;
  description: string;
  severity: ComplaintSeverity;
  category: string;
}): Promise<CreateComplaintResult> {
  const customerName = input.customerName?.trim();
  const description = input.description?.trim();

  if (!customerName) return { success: false, error: "Customer name is required" };
  if (!description) return { success: false, error: "Description is required" };

  const severity: ComplaintSeverity = SEVERITIES.includes(input.severity)
    ? input.severity
    : "medium";
  const category = CATEGORIES.includes(input.category) ? input.category : "Other";

  const created = await prisma.complaint.create({
    data: {
      reference: `C-${nanoid(8).toUpperCase()}`,
      customerName,
      description,
      severity,
      category,
      status: "open",
    },
    select: {
      reference: true,
      customerName: true,
      description: true,
      severity: true,
      category: true,
      status: true,
      createdAt: true,
    },
  });

  revalidatePath("/complaints");
  return { success: true, complaint: toView(created) };
}
