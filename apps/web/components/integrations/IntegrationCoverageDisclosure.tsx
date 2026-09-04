"use client";

import { useState, type ReactNode } from "react";

import { ExpandableCard } from "@/components/ui/report-kit/ExpandableCard";

export function IntegrationCoverageDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div data-testid="integration-coverage-disclosure">
      <ExpandableCard
        id="integration-coverage-disclosure"
        open={open}
        onOpenChange={setOpen}
        summary={<span className="text-sm font-semibold">Employee coverage</span>}
        headingLevel={2}
      >
        {children}
      </ExpandableCard>
    </div>
  );
}
