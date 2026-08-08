import { describe, expect, it } from "vitest";

import { validateFederationCloudEvent } from "./cloud-event-guard";

const event = {
  specversion: "1.0",
  id: "evt_1",
  source: "/dpf",
  type: "dpf.demand.proposed",
  time: "2026-07-20T06:00:00.000Z",
  datacontenttype: "application/json",
  dpflinkid: "link_1",
  data: {},
};

describe("validateFederationCloudEvent", () => {
  it("accepts a current event bound to the authenticated link", () => {
    expect(validateFederationCloudEvent(event, {
      linkId: "link_1", now: new Date("2026-07-20T06:05:00.000Z"),
    })).toEqual([]);
  });

  it("accepts a peer's OWN dpflinkid even when it differs from ours (per-side ids)", () => {
    // The token authenticates + identifies the link; the sender's own link id is
    // minted independently and never equals ours. This MUST be accepted, or no
    // two real installs can ever exchange demand (BI-… link:mismatch regression).
    expect(validateFederationCloudEvent({ ...event, dpflinkid: "link_2" }, {
      linkId: "link_1", now: new Date("2026-07-20T06:05:00.000Z"),
    })).toEqual([]);
  });

  it("accepts an event with no dpflinkid at all", () => {
    const { dpflinkid: _omit, ...noLink } = event;
    void _omit;
    expect(validateFederationCloudEvent(noLink, {
      linkId: "link_1", now: new Date("2026-07-20T06:05:00.000Z"),
    })).toEqual([]);
  });

  it("still rejects a malformed dpflinkid, stale time, and bad envelope fields", () => {
    expect(validateFederationCloudEvent({ ...event, dpflinkid: 42 }, {
      linkId: "link_1", now: new Date("2026-07-20T06:05:00.000Z"),
    })).toEqual(expect.arrayContaining(["dpflinkid:invalid"]));
    expect(validateFederationCloudEvent({ ...event }, {
      linkId: "link_1", now: new Date("2026-07-20T07:00:00.000Z"),
    })).toEqual(expect.arrayContaining(["time:outside-replay-window"]));
    expect(validateFederationCloudEvent({ ...event, id: "", specversion: "0.3" }, {
      linkId: "link_1", now: new Date("2026-07-20T06:05:00.000Z"),
    })).toEqual(expect.arrayContaining(["specversion:unsupported", "id:invalid"]));
  });
});
