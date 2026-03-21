import React from "react";

export default function SetupRouteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--dpf-bg)]">
      {children}
    </div>
  );
}
