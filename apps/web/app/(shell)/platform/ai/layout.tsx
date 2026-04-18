// apps/web/app/(shell)/platform/ai/layout.tsx
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";

export default function AiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PlatformTabNav />
      {children}
    </div>
  );
}
