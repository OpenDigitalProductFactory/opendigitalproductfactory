import { describe, expect, it } from "vitest";

import {
  CHANNEL_IMPLEMENTATION,
  describeChannelAvailability,
  implementedChannels,
  unimplementedChannels,
} from "./channel-parity";
import { COMMUNICATION_CHANNELS } from "./channel-types";

describe("channel/adapter parity", () => {
  it("classifies every declared channel", () => {
    // The Record<CommunicationChannel, ...> type makes this exhaustive at compile
    // time; this asserts it at runtime too, so a widened enum cannot slip through
    // a type assertion.
    expect(Object.keys(CHANNEL_IMPLEMENTATION).sort()).toEqual([...COMMUNICATION_CHANNELS].sort());
  });

  it("gives every unimplemented channel a non-trivial intent", () => {
    for (const channel of unimplementedChannels()) {
      const entry = CHANNEL_IMPLEMENTATION[channel];
      expect(entry.kind).toBe("not-implemented");
      if (entry.kind !== "not-implemented") continue;
      expect(entry.intent.trim().length).toBeGreaterThanOrEqual(20);
    }
  });

  it("never records a backlog identifier as the intent", () => {
    // A hardcoded BI id is install-local data: it dangles on a fresh install and
    // after every backlog reset. Name the intent instead, per the next-step
    // pointer contract in lib/backlog/next-step-pointer.ts.
    for (const channel of unimplementedChannels()) {
      const entry = CHANNEL_IMPLEMENTATION[channel];
      if (entry.kind !== "not-implemented") continue;
      expect(entry.intent).not.toMatch(/\bBI-[A-Z0-9-]+/i);
      expect(entry.intent).not.toMatch(/\bEP-[A-Z0-9-]+/i);
    }
  });

  it("reports an implemented and registered channel as available", () => {
    expect(describeChannelAvailability("in-app", ["in-app"])).toEqual({ state: "available" });
  });

  it("separates not-configured from not-implemented", () => {
    // email has an adapter in the tree; whether it is registered depends on this
    // install carrying Postmark configuration. That is a different answer from
    // slack, which has no adapter at all.
    expect(describeChannelAvailability("email", ["in-app"])).toEqual({
      state: "not-configured",
    });

    const slack = describeChannelAvailability("slack", ["in-app"]);
    expect(slack.state).toBe("not-implemented");
    expect(slack.state === "not-implemented" && slack.intent.length).toBeTruthy();
  });

  it("keeps the two classifications disjoint and total", () => {
    const implemented = implementedChannels();
    const unimplemented = unimplementedChannels();
    expect(implemented.filter((channel) => unimplemented.includes(channel))).toEqual([]);
    expect([...implemented, ...unimplemented].sort()).toEqual([...COMMUNICATION_CHANNELS].sort());
  });

  it("records the channels that currently have no adapter", () => {
    // Fails deliberately when an adapter lands, so the author must reclassify
    // rather than leave the registry stale.
    expect(unimplementedChannels().sort()).toEqual(
      ["slack", "teams", "telegram", "webhook", "whatsapp"].sort(),
    );
  });
});
