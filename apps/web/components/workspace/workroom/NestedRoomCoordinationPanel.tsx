"use client";

import { useState } from "react";
import type { MessageKey } from "@dpf/i18n";
import { ExpandableCard } from "@/components/ui/report-kit/ExpandableCard";
import { useT } from "@/lib/i18n/use-t";
import type { NestedRoomCoordination } from "@/lib/work-management/nested-room-coordination";

const SETUP_HELP: Record<string, MessageKey<"workrooms">> = {
  "incomplete-responsibility-lineage": "nestedRecovery.setup.incompleteLineage",
  "responsibility-cycle": "nestedRecovery.setup.responsibilityCycle",
  "conflicting-responsibility-parents": "nestedRecovery.setup.conflictingParents",
  "conflicting-coordinators": "nestedRecovery.setup.conflictingCoordinators",
  "coordinator-not-recorded": "nestedRecovery.setup.missingCoordinator",
  "agent-escalation-cycle": "nestedRecovery.setup.agentCycle",
  "human-role-unfilled": "nestedRecovery.setup.unfilledRole",
  "human-role-conflict": "nestedRecovery.setup.conflictingRole",
  "role-holder-not-human": "nestedRecovery.setup.nonHumanHolder",
};

export function NestedRoomCoordinationPanel({ coordination }: { coordination: NestedRoomCoordination }) {
  const [open, setOpen] = useState(false);
  const t = useT("workrooms");
  const { escalation } = coordination;
  const needsSetup = escalation.state === "setup-required";
  return <div className="mt-4">
    <ExpandableCard id="nested-room-coordination" open={open} onOpenChange={setOpen}
      summary={<span>{t(needsSetup ? "nestedRecovery.needsAttention" : "nestedRecovery.summary")}</span>}>
      {needsSetup ? <p className="mb-2 text-sm text-[var(--dpf-muted)]">
        {t(SETUP_HELP[escalation.reason] ?? "nestedRecovery.setup.incompleteRoute")}
      </p> : null}
      <p className="mb-2 text-sm text-[var(--dpf-muted)]">
        {t("nestedRecovery.accountability")}
      </p>
      <p className="text-sm text-[var(--dpf-muted)]">{t("nestedRecovery.recordedRoute")}</p>
      {coordination.delegations.length ? <p className="mt-2 text-sm text-[var(--dpf-muted)]">
        {t("nestedRecovery.responsibility")}
      </p> : null}
      {escalation.steps.length ? <ol className="mt-2 list-decimal space-y-2 ps-5">
        {escalation.steps.map((step, index) => <li key={`${step.kind}:${step.ref}:${index}`} className="text-sm text-[var(--dpf-text)]">
          {step.displayName}
        </li>)}
      </ol> : null}
    </ExpandableCard>
  </div>;
}
