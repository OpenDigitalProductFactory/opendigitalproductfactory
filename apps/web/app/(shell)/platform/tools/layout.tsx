// apps/web/app/(shell)/platform/tools/layout.tsx
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";
import { ToolsTabNav } from "@/components/platform/ToolsTabNav";

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PlatformTabNav />
      <ToolsTabNav />
      {children}
    </div>
  );
}
