import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/(shell)/workspace/ward/actions", () => ({
  manageHousingAction: vi.fn(),
}));

import { WardOperations } from "./WardOperations";

describe("WardOperations", () => {
  it("keeps routine placement visible and setup progressively disclosed", () => {
    const html = renderToStaticMarkup(
      <WardOperations
        animals={[{ animalRef: "animal-1", name: "Ranger", allocationId: null, resourceId: null }]}
        resources={[
          {
            id: "foster-1", label: "Northside foster", kindSlug: "foster-home",
            capacity: 2, occupied: 1, available: 1, blockedReason: null, version: 1,
          },
        ]}
      />,
    );

    expect(html).toMatch(/Place or move an animal/i);
    expect(html).toMatch(/Housing setup/i);
    expect(html).toContain("<details");
    expect(html).toMatch(/Kennel|Foster home/);
    expect(html).toMatch(/Save changes/i);
    expect(html).toContain('name="capacity"');
    expect(html).toContain("min-h-11");
    const visibleControls = [...html.matchAll(/<(?:input|select|button)\b[^>]*>/g)]
      .map(([tag]) => tag)
      .filter((tag) => !tag.includes('type="hidden"'));
    expect(visibleControls.length).toBeGreaterThan(0);
    for (const control of visibleControls) expect(control).toContain("min-h-11");
    expect(html).not.toMatch(/home address/i);
  });

  it("explains when no compatible destination is available", () => {
    const html = renderToStaticMarkup(
      <WardOperations
        animals={[{ animalRef: "animal-1", name: "Ranger", allocationId: null, resourceId: null }]}
        resources={[
          {
            id: "kennel-1", label: "D1", kindSlug: "kennel", capacity: 1,
            occupied: 1, available: 0, blockedReason: null, version: 1,
          },
        ]}
      />,
    );
    expect(html).toMatch(/No open housing destination/i);
  });
});
