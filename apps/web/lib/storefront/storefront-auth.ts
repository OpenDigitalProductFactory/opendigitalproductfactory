import { prisma } from "@dpf/db";

export enum EmailType {
  Customer = "customer",
  Employee = "employee",
  Unknown = "unknown",
}

/** Checks whether an email belongs to a CustomerContact or a User (employee/admin). */
export async function detectEmailType(email: string): Promise<EmailType> {
  const [contact, user] = await Promise.all([
    prisma.customerContact.findUnique({ where: { email }, select: { id: true } }),
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
  ]);

  if (contact) return EmailType.Customer;
  if (user) return EmailType.Employee;
  return EmailType.Unknown;
}
