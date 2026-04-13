// apps/web/app/(shell)/platform/audit/page.tsx
// Redirect bare /platform/audit to the default tab.
import { redirect } from "next/navigation";

export default function AuditRootRedirect() {
  redirect("/platform/audit/ledger");
}
