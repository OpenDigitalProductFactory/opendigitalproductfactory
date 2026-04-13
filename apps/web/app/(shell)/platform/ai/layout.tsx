// apps/web/app/(shell)/platform/ai/layout.tsx
import { WorkforceTabNav } from "@/components/platform/WorkforceTabNav";

export default function AiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <WorkforceTabNav />
      {children}
    </div>
  );
}
