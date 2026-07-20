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

  it("rejects stale, future, malformed, or cross-link replay", () => {
    expect(validateFederationCloudEvent({ ...event, dpflinkid: "link_2" }, {
      linkId: "link_1", now: new Date("2026-07-20T07:00:00.000Z"),
    })).toEqual(expect.arrayContaining(["link:mismatch", "time:outside-replay-window"]));
    expect(validateFederationCloudEvent({ ...event, id: "", specversion: "0.3" }, {
      linkId: "link_1", now: new Date("2026-07-20T06:05:00.000Z"),
    })).toEqual(expect.arrayContaining(["specversion:unsupported", "id:invalid"]));
  });
});
