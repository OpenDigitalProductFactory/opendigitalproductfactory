import { EXCLUDE_TOMBSTONED } from "@dpf/db/customer-lifecycle";
import type { CustomerOperatingFacts, CustomerRecordLinks } from "@dpf/storefront-templates/operations";
import { can, type UserContext } from "@/lib/permissions";

type FindMany = (args: unknown) => Promise<unknown>;
export interface CustomerOperationsClient {
  customerAccount?: { findMany: FindMany };
  subscription?: { findMany: FindMany };
  serviceTicket?: { findMany: FindMany };
}
interface ReadRuntime {
  read<T>(source: string, operation: Promise<T>, fallback: T): Promise<T>;
  unavailable(source: string): void;
}
const LIMIT = 64;
/** Existing DPF routes are a host adapter, never portable-core defaults. */
export const DPF_CUSTOMER_RECORD_LINKS: CustomerRecordLinks = {
  account: (id) => ({ label: "Open customer", href: `/customer/${encodeURIComponent(id)}` }),
  serviceWork: () => ({ label: "Open service desk", href: "/platform/service-desk" }),
};
async function bounded<T>(operation: Promise<unknown>): Promise<T[]> {
  const rows = await operation as T[];
  if (!Array.isArray(rows) || rows.length > LIMIT) throw new Error("Operating source exceeds bounded projection");
  return rows;
}

/** Current server-derived viewer context is required. No permission grants or persistent writes. */
export async function loadCustomerOperatingFacts(input: {
  db: CustomerOperationsClient;
  viewer?: UserContext;
  runtime: ReadRuntime;
}): Promise<CustomerOperatingFacts> {
  const { db, viewer, runtime } = input;
  if (!viewer || !can(viewer, "view_customer") || !db.customerAccount?.findMany) {
    for (const source of ["customers", "customer-commitments", "customer-service-work"]) runtime.unavailable(source);
    return { accounts: null, commitments: null, serviceWork: null };
  }
  const accounts = await runtime.read("customers", bounded<{ id: string; name: string; status: string }>(db.customerAccount.findMany({
    where: { ...EXCLUDE_TOMBSTONED, mergedIntoId: null },
    select: { id: true, name: true, status: true }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: LIMIT + 1,
  })), null);
  if (accounts == null) {
    runtime.unavailable("customer-commitments"); runtime.unavailable("customer-service-work");
    return { accounts: null, commitments: null, serviceWork: null };
  }
  const ids = accounts.map((a) => a.id);
  const [commitments, serviceWork] = await Promise.all([
    db.subscription?.findMany
      ? runtime.read("customer-commitments", bounded<{ id: string; accountId: string; status: string; renewalDate: Date; autoRenew: boolean }>(db.subscription.findMany({
          where: { accountId: { in: ids }, status: "active" }, select: { id: true, accountId: true, status: true, renewalDate: true, autoRenew: true }, orderBy: [{ renewalDate: "asc" }, { id: "asc" }], take: LIMIT + 1,
        })).then((rows) => rows.map((r) => ({ id: r.id, accountId: r.accountId, status: r.status, renewalAt: r.renewalDate.toISOString(), autoRenew: r.autoRenew }))), null)
      : (runtime.unavailable("customer-commitments"), Promise.resolve(null)),
    can(viewer, "manage_platform") && db.serviceTicket?.findMany
      ? runtime.read("customer-service-work", bounded<{ id: string; ticketId: string; customerAccountId: string | null; title: string; status: string; priority: string; slaDueAt: Date | null; ownerPrincipalId: string | null }>(db.serviceTicket.findMany({
          where: { customerAccountId: { in: ids }, status: { notIn: ["resolved", "closed"] } },
          select: { id: true, ticketId: true, customerAccountId: true, title: true, status: true, priority: true, slaDueAt: true, ownerPrincipalId: true },
          orderBy: [{ slaDueAt: "asc" }, { id: "asc" }], take: LIMIT + 1,
        })).then((rows) => rows.map((r) => ({ id: r.id, reference: r.ticketId, accountId: r.customerAccountId, title: r.title, status: r.status, priority: r.priority, dueAt: r.slaDueAt?.toISOString() ?? null, ownerRef: r.ownerPrincipalId, owner: null }))), null)
      : (runtime.unavailable("customer-service-work"), Promise.resolve(null)),
  ]);
  return { accounts, commitments, serviceWork };
}
