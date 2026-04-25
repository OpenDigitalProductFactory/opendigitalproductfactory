import React from "react";
import { ContextualDocsButton } from "@/components/docs/ContextualDocsButton";

export default function SetupRouteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--dpf-bg)]">
      <div className="flex justify-end px-4 pt-4">
        <ContextualDocsButton routeOverride="/setup" />
      </div>
      {children}
    </div>
  );
}
