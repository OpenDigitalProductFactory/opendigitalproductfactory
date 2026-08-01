// Risk-driven reach policy — which attention items earn an off-site message, on which
// channels, and what that message is allowed to do.
// Spec: docs/superpowers/specs/2026-08-01-attention-reach-layer-design.md §4.1
//
// WHY THIS EXISTS: lib/communications/dispatch-policy.ts selects channels by URGENCY ALONE.
// Risk never enters, so a money-out approval and a distilled memory note route identically.
// Reach without risk is how a platform ends up emailing an owner at 2am about a container
// restart while a customer waiting on a quote sits silently in an inbox.
//
// This module does NOT re-derive risk. `classifyOwnerAttentionLane` already owns that
// judgment and is already the thing the in-app surface obeys; a second classifier would be
// a second source of truth that drifts (BI-C7D25599 requires every channel to reach the
// SAME decision module).

import {
  classifyOwnerAttentionLane,
  type OwnerAttentionLaneDecision,
} from "./owner-routing";
import type { AttentionItem } from "./types";
import {
  selectCommunicationPlan,
  type CommunicationBindingSummary,
} from "@/lib/communications/dispatch-policy";
import type {
  CommunicationChannel,
  CommunicationUrgency,
} from "@/lib/communications/channel-types";

export type ReachDecision = {
  /** False when this item earns no off-site message at all. */
  reachable: boolean;
  /** Channels to send on, in preference order. Empty when `reachable` is false. */
  channels: CommunicationChannel[];
  /** Urgency handed to the existing dispatch policy. */
  urgency: CommunicationUrgency;
  /**
   * Whether this item's CLASS could ever be actioned from a message.
   *
   * P1 builds no action-bearing message, so nothing consumes this to grant anything — it
   * drives the message WORDING, so a hard-floored item says plainly that it must be opened
   * to decide. It is also the assertion point for the acceptance test: no hard-floored
   * source may ever be eligible, whatever else changes.
   */
  oneClickEligible: boolean;
  /** Plain-language why, carried into evidence so a send is explicable after the fact. */
  reason: string;
  /** The underlying lane decision, surfaced so callers need not re-classify. */
  lane: OwnerAttentionLaneDecision;
};

export type ReachPolicyInput = {
  item: AttentionItem;
  bindings: readonly CommunicationBindingSummary[];
  now: Date;
};

/**
 * Map an attention item to a dispatch urgency.
 *
 * Deadline pressure raises urgency, but a hard floor raises it on its own: money leaving
 * the business is urgent whether or not anyone attached a due date to it.
 */
export function reachUrgency(item: AttentionItem, hardFloor: boolean): CommunicationUrgency {
  if (item.triage.timeToAct === "overdue") return "urgent";
  if (item.triage.irreversible && hardFloor) return "urgent";
  if (hardFloor) return "priority";
  if (item.triage.timeToAct === "due-today") return "priority";
  return "routine";
}

/**
 * Decide whether and how to reach the owner off-site.
 *
 * Three lanes, three answers:
 * - `custodian` — technical work the platform's custodian owns. No off-site reach. An
 *   outage is not an owner interruption; routing it to their phone is the exact failure
 *   this program exists to remove.
 * - `weekly-digest` — batched by design. No individual send; the digest is the channel.
 * - `needs-you-now` — earns reach.
 */
export function planReach(input: ReachPolicyInput): ReachDecision {
  const lane = classifyOwnerAttentionLane(input.item);

  if (lane.lane === "custodian") {
    return unreachable(lane, "Technical custodian work is not an owner interruption.");
  }
  if (lane.lane === "weekly-digest") {
    return unreachable(lane, "Batched into the weekly digest rather than sent on its own.");
  }

  const urgency = reachUrgency(input.item, lane.hardFloor);
  const plan = selectCommunicationPlan({
    urgency,
    bindings: input.bindings,
    now: input.now,
  });

  return {
    reachable: plan.channels.length > 0,
    channels: plan.channels,
    urgency,
    // A hard floor is exactly the set that must never be actionable from a message:
    // money leaving, something going public, a customer waiting on the owner personally.
    // Irreversible work is excluded for the same reason even without a floor.
    oneClickEligible: !lane.hardFloor && !input.item.triage.irreversible,
    reason: lane.reason,
    lane,
  };
}

function unreachable(lane: OwnerAttentionLaneDecision, reason: string): ReachDecision {
  return {
    reachable: false,
    channels: [],
    urgency: "routine",
    oneClickEligible: false,
    reason,
    lane,
  };
}
