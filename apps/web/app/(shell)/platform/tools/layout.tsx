// apps/web/app/(shell)/platform/tools/layout.tsx
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PlatformTabNav />
      {children}
    </div>
  );
}
