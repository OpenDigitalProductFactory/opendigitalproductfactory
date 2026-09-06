// Channel/adapter parity for the communication dispatcher (EP-03CC88EF).
//
// `COMMUNICATION_CHANNELS` declares eight channels. The dispatcher registers far
// fewer, and its only answer to the difference is a per-send `adapter_not_registered`
// failure — which surfaces after a message needed to go, not before.
//
// That gap has already cost twice. `email` was a declared channel with no adapter
// for long enough that someone wrote one; that adapter was then never registered,
// so the bug it fixed still applied to it. Nothing announced either state.
//
// This module makes the classification explicit and total. `CHANNEL_IMPLEMENTATION`
// is a `Record` keyed by the channel union, so widening `COMMUNICATION_CHANNELS`
// fails the production build until the new channel is classified. A developer
// cannot add a channel without deciding what happens when someone sends to it.
//
// Note the deliberate split between *implemented* and *registered*. Whether an
// adapter exists in the tree is a property of the code; whether it is active is a
// property of this install's configuration (Postmark for email, an Expo project
// for push). Surfaces need both answers, and they are not the same answer.

import { COMMUNICATION_CHANNELS, type CommunicationChannel } from "./channel-types";

export type ChannelImplementation =
  /** An adapter for this channel exists in the tree. It may still be unregistered here. */
  | { readonly kind: "implemented" }
  /** No adapter exists. `intent` says what would have to be built, in prose. */
  | { readonly kind: "not-implemented"; readonly intent: string };

/**
 * Every declared channel, classified.
 *
 * `intent` is prose on purpose. A backlog identifier is install-local data: it
 * dangles on a fresh install and after every backlog reset, which is exactly the
 * defect the next-step pointer contract in `lib/backlog/next-step-pointer.ts`
 * exists to prevent. Name the work, not an id.
 */
export const CHANNEL_IMPLEMENTATION: Record<CommunicationChannel, ChannelImplementation> = {
  "in-app": { kind: "implemented" },
  push: { kind: "implemented" },
  email: { kind: "implemented" },
  teams: {
    kind: "not-implemented",
    intent:
      "Outbound adapter against the Graph chatMessage API, reusing the existing microsoft365 credential provider.",
  },
  slack: {
    kind: "not-implemented",
    intent:
      "Slack credential provider plus an outbound adapter against chat.postMessage; the tier-1 integration manifest already names the provider.",
  },
  whatsapp: {
    kind: "not-implemented",
    intent:
      "Outbound adapter against the Cloud API, reusing the existing WhatsApp Secretary Gateway rather than a second WhatsApp path.",
  },
  telegram: {
    kind: "not-implemented",
    intent:
      "Outbound adapter for the emergency fan-out tier; no owning archetype has asked for it yet.",
  },
  webhook: {
    kind: "not-implemented",
    intent:
      "Generic outbound webhook for the emergency fan-out tier; needs a per-install endpoint and signing contract first.",
  },
};

export function implementedChannels(): CommunicationChannel[] {
  return COMMUNICATION_CHANNELS.filter(
    (channel) => CHANNEL_IMPLEMENTATION[channel].kind === "implemented",
  );
}

export function unimplementedChannels(): CommunicationChannel[] {
  return COMMUNICATION_CHANNELS.filter(
    (channel) => CHANNEL_IMPLEMENTATION[channel].kind === "not-implemented",
  );
}

export type ChannelAvailability =
  /** An adapter exists and is registered on this install. */
  | { readonly state: "available" }
  /** An adapter exists but this install has not configured it. */
  | { readonly state: "not-configured" }
  /** No adapter exists anywhere. `intent` says what building it would mean. */
  | { readonly state: "not-implemented"; readonly intent: string };

/**
 * What a surface should say about a channel, given the adapters actually
 * registered on this install.
 *
 * Offering a channel that cannot deliver is the user-facing half of the same
 * defect: the integrations page currently lists Slack alongside working channels
 * with nothing to distinguish them.
 */
export function describeChannelAvailability(
  channel: CommunicationChannel,
  registeredChannels: readonly CommunicationChannel[],
): ChannelAvailability {
  const implementation = CHANNEL_IMPLEMENTATION[channel];
  if (implementation.kind === "not-implemented") {
    return { state: "not-implemented", intent: implementation.intent };
  }
  return registeredChannels.includes(channel)
    ? { state: "available" }
    : { state: "not-configured" };
}
