"use client";

// apps/web/components/twin/TwinView.tsx
//
// The profile-driven twin renderer (EP-LIVING-BUSINESS-VIZ P3). Given a
// `TwinProfile` (which template + nouns/zones/queues/cog) and a `TwinSnapshot`
// (the live values), it composes the grammar kit into the right layout — one
// component for every archetype, physical or board. This is the piece that
// replaces the four hand-built HTML prototypes with framework rendering.
//
// Client because it hosts the interactive cog (HITL confirm). The zones/queues/
// feed are all kit primitives; only the vocabulary and which-template come from
// the profile.

import { useEffect, useMemo, useState } from "react";

import type { TwinProfile } from "@dpf/storefront-templates";
import type { OperationalCommandResult } from "@/lib/twin/operations-command";
import {
  createOperationsInteractionMeasure,
  markOperationsDecisionSurfaceReady,
} from "@/lib/twin/operations-telemetry";

import { AttributedFeed } from "./AttributedFeed";
import { CapacityChips } from "./CapacityChips";
import { CogBanner } from "./CogBanner";
import { NeedsYouQuests } from "./NeedsYouQuests";
import { PresenceRow } from "./PresenceRow";
import { ResourceUnitGrid } from "./ResourceUnit";
import { TwinQueue } from "./TwinQueue";
import { TwinZone } from "./TwinZone";
import { OutcomesStrip } from "./OutcomesStrip";
import { UtilityBand } from "./UtilityBand";
import { ValueStreamStrip } from "./ValueStreamStrip";
import { WorkItem } from "./WorkItem";
import type { TwinSnapshot } from "./snapshot";

export interface TwinViewProps {
  profile: TwinProfile;
  snapshot: TwinSnapshot;
  className?: string;
  /** Durable command closure supplied by an archetype adapter. */
  onConfirmCog?: () => Promise<OperationalCommandResult>;
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function TwinView({ profile, snapshot, className = "", onConfirmCog }: TwinViewProps) {
  const [cogStatus, setCogStatus] = useState<
    "idle" | "pending" | "confirmed" | "conflict" | "rejected" | "unsupported"
  >(onConfirmCog ? "idle" : "unsupported");
  const [cogStatusMessage, setCogStatusMessage] = useState<string | undefined>();
  const [cogAlternatives, setCogAlternatives] = useState<string[]>([]);

  useEffect(() => {
    if (
      typeof performance !== "undefined" &&
      typeof performance.mark === "function" &&
      typeof performance.getEntriesByName === "function"
    ) {
      markOperationsDecisionSurfaceReady(performance);
    }
  }, []);

  async function confirmCog() {
    if (!onConfirmCog) return;
    const finishMeasure =
      typeof performance !== "undefined" &&
      typeof performance.mark === "function" &&
      typeof performance.measure === "function"
        ? createOperationsInteractionMeasure(
            performance,
            "assign",
            `cog-${Date.now().toString(36)}`,
          )
        : () => undefined;
    setCogStatus("pending");
    setCogStatusMessage("Assigning…");
    setCogAlternatives([]);
    try {
      const result = await onConfirmCog();
      finishMeasure(result.status);
      setCogStatus(result.status);
      setCogAlternatives(
        result.status === "conflict"
          ? result.alternatives.map((alternative) => alternative.label)
          : [],
      );
      setCogStatusMessage(
        result.status === "conflict"
          ? "The operation changed. Review the latest state and try again."
          : result.status === "rejected" || result.status === "unsupported"
            ? result.message
            : undefined,
      );
    } catch {
      finishMeasure("rejected");
      setCogStatus("rejected");
      setCogAlternatives([]);
      setCogStatusMessage("The assignment could not be confirmed. Nothing was changed.");
    }
  }

  // Zone label lookup comes from the profile; the snapshot supplies the units.
  const zoneLabel = useMemo(() => {
    const map = new Map(profile.zones.map((z) => [z.key, z.label]));
    return (key: string) => map.get(key) ?? titleCase(key);
  }, [profile.zones]);

  const queueLabel = useMemo(() => {
    const map = new Map(profile.queues.map((q) => [q.key, q.label]));
    return (key: string) => map.get(key) ?? titleCase(key);
  }, [profile.queues]);

  // Physical twins render space (a grid of zones); board twins render a portfolio
  // (a single wide board). Both share the same primitives — only emphasis differs.
  const zoneWrapClass = profile.physical
    ? "grid gap-3 sm:grid-cols-2"
    : "grid gap-3";

  return (
    <div className={`flex flex-col gap-4 ${className}`.trim()}>
      <CapacityChips chips={snapshot.capacityChips} />

      {snapshot.stageFlow && snapshot.stageFlow.length > 0 ? (
        <ValueStreamStrip stages={snapshot.stageFlow} />
      ) : null}

      {snapshot.outcomes && snapshot.outcomes.length > 0 ? (
        <OutcomesStrip outcomes={snapshot.outcomes} />
      ) : null}

      <PresenceRow members={snapshot.presence} />

      {snapshot.cog ? (
        <CogBanner
          proposal={snapshot.cog.proposal}
          signals={snapshot.cog.signals ?? profile.cog.signals}
          confirmLabel={snapshot.cog.confirmLabel}
          status={cogStatus}
          statusMessage={cogStatusMessage}
          alternatives={cogAlternatives}
          onConfirm={onConfirmCog ? () => void confirmCog() : undefined}
          onDismiss={() => {
            setCogStatus("rejected");
            setCogAlternatives([]);
            setCogStatusMessage("Suggestion dismissed. Nothing was changed.");
          }}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Left: the operation itself — zones of resource units + work in flight. */}
        <div className="flex flex-col gap-3">
          <div className={zoneWrapClass}>
            {snapshot.zones.map((zone) => (
              <TwinZone
                key={zone.key}
                label={zoneLabel(zone.key)}
                meta={zone.meta ?? `${zone.units.length} ${profile.resourceNoun.plural}`}
              >
                <ResourceUnitGrid units={zone.units} className="!grid-cols-2" />
              </TwinZone>
            ))}
          </div>

          {snapshot.workItems.length > 0 ? (
            <TwinZone label={titleCase(profile.workItemNoun.plural)}>
              <div className="flex flex-col gap-2">
                {snapshot.workItems.map(({ key, ...item }) => (
                  <WorkItem key={key} {...item} />
                ))}
              </div>
            </TwinZone>
          ) : null}
        </div>

        {/* Right: the heartbeat — queues, what-needs-you, and the shared feed. */}
        <div className="flex flex-col gap-3">
          {snapshot.queues.map((queue) => (
            <TwinQueue
              key={queue.key}
              label={queueLabel(queue.key)}
              items={queue.items}
              emptyLabel={queue.emptyLabel}
            />
          ))}

          <TwinZone label="Needs you">
            <NeedsYouQuests quests={snapshot.quests} />
          </TwinZone>

          <TwinZone label="Activity">
            <AttributedFeed events={snapshot.feed} />
          </TwinZone>
        </div>
      </div>

      <UtilityBand meters={snapshot.utility} />
    </div>
  );
}
