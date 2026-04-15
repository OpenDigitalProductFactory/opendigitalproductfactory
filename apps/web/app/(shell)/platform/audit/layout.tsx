// apps/web/app/(shell)/platform/audit/layout.tsx
import { AuditTabNav } from "@/components/platform/AuditTabNav";

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <AuditTabNav />
      {children}
    </div>
  );
}
