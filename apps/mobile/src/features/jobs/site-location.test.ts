import type { WorkItemSite } from "@dpf/types";
import { chooseOffer, farQuestion, isDismissed, offerQuestion } from "./site-location";

const site = (id: string, over: Partial<WorkItemSite> = {}): WorkItemSite => ({
  id, name: `Site ${id}`, addressLine: "1 Main", hasAddress: true, hasLocation: false, locationConfirmed: false, ...over,
});
const NOW = new Date("2026-10-07T12:00:00Z");

describe("chooseOffer (AC-ALC-VISIT-1)", () => {
  it("offers the job's only site when it needs a confirmed location", () => {
    expect(chooseOffer([site("a")], {}, NOW)).toEqual({ kind: "one", site: site("a") });
  });

  it("offers nothing for a confirmed site or a site with no address", () => {
    expect(chooseOffer([site("a", { hasLocation: true, locationConfirmed: true })], {}, NOW)).toEqual({ kind: "none" });
    expect(chooseOffer([site("a", { hasAddress: false })], {}, NOW)).toEqual({ kind: "none" });
  });

  it("lets the person choose when the account has several sites", () => {
    const offer = chooseOffer([site("a"), site("b", { locationConfirmed: true, hasLocation: true }), site("c")], {}, NOW);
    expect(offer).toEqual({ kind: "choose", sites: [site("a"), site("c")] });
  });

  it("remembers Not now for 30 days", () => {
    expect(chooseOffer([site("a")], { a: "2026-09-20T12:00:00Z" }, NOW)).toEqual({ kind: "none" });
    expect(isDismissed({ a: "2026-09-01T12:00:00Z" }, "a", NOW)).toBe(false);
  });
});

describe("wording", () => {
  it("says the location is used once, for this site only", () => {
    expect(offerQuestion(site("a"))).toBe("Set the location of Site a from where you are now? Your phone's location is used once, for this site only.");
  });

  it("states the distance before accepting a far fix", () => {
    expect(farQuestion(3400)).toBe("The address on file is 3.4 km from you. Are you at the site?");
    expect(farQuestion(25_600)).toBe("The address on file is 26 km from you. Are you at the site?");
  });
});
