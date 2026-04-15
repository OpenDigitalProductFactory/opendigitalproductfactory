// apps/web/app/(shell)/platform/tools/layout.tsx
import { ToolsTabNav } from "@/components/platform/ToolsTabNav";

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <ToolsTabNav />
      {children}
    </div>
  );
}
