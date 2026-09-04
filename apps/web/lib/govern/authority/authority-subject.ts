import { canAccessEmployeeRecord } from "@/lib/govern/permissions";
import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";

export type AuthoritySubject =
  | { kind: "employee"; id: string }
  | { kind: "account"; id: string }
  | { kind: "contact"; id: string }
  | { kind: "partner-account"; id: string }
  | { kind: "principal"; id: string }
  | { kind: "team"; id: string }
  | { kind: "backlog-item"; id: string }
  | { kind: "platform"; id: string };

function canAccessCustomerScope(
  context: EffectiveAuthContext,
  ids: readonly string[],
  subjectId: string,
): boolean {
  if (!ids.includes(subjectId)) return false;
  return (
    context.population === "customer" ||
    context.population === "partner" ||
    context.grantedCapabilities.includes("view_customer")
  );
}

export function canAccessAuthoritySubject(
  context: EffectiveAuthContext,
  subject: AuthoritySubject | null | undefined,
  governedOrganizationId?: string | null,
): boolean {
  if (!subject || subject.kind === "platform") return true;
  switch (subject.kind) {
    case "employee":
      return canAccessEmployeeRecord(context, subject.id);
    case "account":
      return canAccessCustomerScope(
        context,
        context.accountScope.accountIds,
        subject.id,
      );
    case "contact":
      return canAccessCustomerScope(
        context,
        context.accountScope.contactIds,
        subject.id,
      );
    case "partner-account":
      return canAccessCustomerScope(
        context,
        context.accountScope.partnerAccountIds,
        subject.id,
      );
    case "principal":
      return context.principalId === subject.id;
    case "team":
      return context.teamIds.includes(subject.id);
    case "backlog-item":
      // Record access is capability-gated by the governed tool. Initiative
      // organization authority is resolved independently from the canonical
      // BacklogItem before the authorization decision is written.
      return Boolean(governedOrganizationId);
  }
}
