// apps/web/app/(shell)/platform/audit/layout.tsx
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PlatformTabNav />
      {children}
    </div>
  );
}
