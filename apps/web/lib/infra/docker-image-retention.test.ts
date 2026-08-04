import { describe, expect, it } from "vitest";

import {
  imageGroupKey,
  isManagedImage,
  parseDockerImageRows,
  planStaleImageReaping,
  type DockerImageRow,
} from "./docker-image-retention";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

function img(repository: string, ageDays: number): DockerImageRow {
  return { repository, tag: `${repository}:latest`, createdAt: NOW - ageDays * DAY };
}

describe("the namespace allowlist is the load-bearing safety property", () => {
  it("leaves everything outside the managed namespaces alone, however old", () => {
    // Without this, an age sweep would delete postgres, grafana, and the portal
    // image itself — turning a housekeeping job into an outage.
    const result = planStaleImageReaping({
      images: [
        img("postgres", 400),
        img("dpf-portal", 400),
        img("dpf-sandbox", 400),
        img("dpf-promoter", 400),
        img("grafana/grafana-oss", 400),
        img("inngest/inngest", 400),
      ],
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("recognises exactly the two managed shapes", () => {
    expect(isManagedImage("dpf-local-integration-slot-0-foo-build")).toBe(true);
    expect(isManagedImage("dpf-local-integration-foo-build")).toBe(true);
    expect(isManagedImage("dpf-hotel-room-ux-local-ci-portal")).toBe(true);
    expect(isManagedImage("dpf-portal")).toBe(false);
    expect(isManagedImage("dpf-promoter")).toBe(false);
    expect(isManagedImage("postgres")).toBe(false);
  });
});

describe("never reap something a container references", () => {
  it("skips an in-use image however old, matched by repository", () => {
    const result = planStaleImageReaping({
      images: [img("dpf-local-integration-slot-0-live-build", 90), img("dpf-local-integration-slot-0-newer-build", 1)],
      inUse: ["dpf-local-integration-slot-0-live-build"],
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("also matches an in-use reference given as repository:tag", () => {
    const result = planStaleImageReaping({
      images: [img("dpf-local-integration-slot-0-live-build", 90), img("dpf-local-integration-slot-0-newer-build", 1)],
      inUse: ["dpf-local-integration-slot-0-live-build:latest"],
      now: NOW,
    });
    expect(result).toEqual([]);
  });
});

describe("keep one warm image per group", () => {
  it("keeps the newest in a group even when it is ancient", () => {
    // Reaping a live slot's only image forces a cold rebuild next run — the
    // cost this retention exists to stop paying repeatedly.
    expect(
      planStaleImageReaping({ images: [img("dpf-local-integration-slot-0-only-build", 400)], now: NOW }),
    ).toEqual([]);
  });

  it("reaps the older sibling once a newer one exists", () => {
    expect(
      planStaleImageReaping({
        images: [
          img("dpf-local-integration-slot-0-old-build", 30),
          img("dpf-local-integration-slot-0-new-build", 1),
        ],
        now: NOW,
      }),
    ).toEqual(["dpf-local-integration-slot-0-old-build:latest"]);
  });

  it("treats each slot as its own group so one slot cannot starve another", () => {
    expect(
      planStaleImageReaping({
        images: [
          img("dpf-local-integration-slot-0-a-build", 30),
          img("dpf-local-integration-slot-0-b-build", 29),
          img("dpf-local-integration-slot-1-c-build", 28),
        ],
        now: NOW,
      }),
    ).toEqual(["dpf-local-integration-slot-0-a-build:latest"]);
  });

  it("groups a one-off local-ci-portal image by itself, so age alone never reaps the last copy", () => {
    expect(
      planStaleImageReaping({
        images: [img("dpf-hotel-room-ux-local-ci-portal", 60), img("dpf-other-local-ci-portal", 60)],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("groups unslotted local-integration images by repository", () => {
    expect(imageGroupKey("dpf-local-integration-slot-3-x-build")).toBe("dpf-local-integration-slot-3");
    expect(imageGroupKey("dpf-local-integration-x-build")).toBe("dpf-local-integration-x-build");
  });
});

describe("age threshold", () => {
  const images = [
    img("dpf-local-integration-slot-0-old-build", 3),
    img("dpf-local-integration-slot-0-new-build", 1),
  ];

  it("keeps a superseded image that is still inside the window", () => {
    expect(planStaleImageReaping({ images, now: NOW, maxAgeMs: 7 * DAY })).toEqual([]);
  });

  it("reaps it once past the window", () => {
    expect(planStaleImageReaping({ images, now: NOW, maxAgeMs: 2 * DAY })).toEqual([
      "dpf-local-integration-slot-0-old-build:latest",
    ]);
  });
});

describe("parseDockerImageRows", () => {
  it("parses the docker format string this job uses", () => {
    const rows = parseDockerImageRows(
      "dpf-local-integration-slot-0-a-build||dpf-local-integration-slot-0-a-build:latest||2026-08-01 10:00:00 -0500 CDT",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].repository).toBe("dpf-local-integration-slot-0-a-build");
    expect(Number.isFinite(rows[0].createdAt)).toBe(true);
  });

  it("DROPS a row with an unparseable date rather than treating it as epoch 0", () => {
    // An NaN date coerced to 0 would look infinitely old and be reaped first —
    // exactly backwards.
    expect(parseDockerImageRows("repo||repo:latest||not-a-date")).toEqual([]);
  });

  it("is safe on empty and ragged input", () => {
    expect(parseDockerImageRows("")).toEqual([]);
    expect(parseDockerImageRows("\n\n")).toEqual([]);
    expect(parseDockerImageRows("only-one-field")).toEqual([]);
  });
});

describe("malformed input cannot crash the sweep", () => {
  it("survives nulls and wrong types", () => {
    const images = [null, undefined, {}, { repository: 5 }, { repository: "x" }] as unknown as DockerImageRow[];
    expect(planStaleImageReaping({ images, now: NOW })).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(planStaleImageReaping({ images: [] })).toEqual([]);
  });
});
