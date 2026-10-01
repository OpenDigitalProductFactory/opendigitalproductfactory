import { prisma } from "@dpf/db";

// Human-readable sequential refs for invoices and payments (INV-2026-0001).
// Extracted from lib/actions/finance.ts so that "use server" module stays under
// its size ceiling. The single home of both numbering rules.

export async function generateInvoiceRef(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.invoice.count();
  const seq = String(count + 1).padStart(4, "0");
  return `INV-${year}-${seq}`;
}

export async function generatePaymentRef(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.payment.count();
  const seq = String(count + 1).padStart(4, "0");
  return `PAY-${year}-${seq}`;
}
