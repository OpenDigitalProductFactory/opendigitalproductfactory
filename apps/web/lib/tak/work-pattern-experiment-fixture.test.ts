import { describe, expect, it } from "vitest";

import {
  buildWorkPatternFixtureArtifactParts,
  parseHermeticBuildReplayFixture,
  type HermeticBuildReplayFixture,
  workPatternFixtureArtifactId,
  workPatternFixtureDigest,
} from "./work-pattern-experiment-fixture";

const fixture = {
  schemaVersion: 1,
  kind: "build-replay-v1",
  objective: "Implement the bounded helper.",
  targetFile: "apps/web/lib/fixtures/bounded.ts",
  testFiles: ["apps/web/lib/fixtures/bounded.test.ts"],
  methodInstructions: {
    baseline: "Prefer the smallest pure implementation.",
  },
} satisfies HermeticBuildReplayFixture;

describe("work-pattern experiment fixture", () => {
  it("parses both the direct compatibility shape and canonical TaskArtifact envelope", () => {
    expect(parseHermeticBuildReplayFixture(fixture)).toEqual(fixture);
    expect(
      parseHermeticBuildReplayFixture(
        buildWorkPatternFixtureArtifactParts(fixture),
      ),
    ).toEqual(fixture);
  });

  it("rejects unsafe build targets before persistence or execution", () => {
    expect(parseHermeticBuildReplayFixture({
      ...fixture,
      targetFile: "apps/web/app/build/page.tsx",
    })).toBeNull();
    expect(parseHermeticBuildReplayFixture({
      ...fixture,
      testFiles: ["../../outside.test.ts"],
    })).toBeNull();
  });

  it("derives stable identities while keeping the fixture digest independently auditable", () => {
    expect(
      workPatternFixtureArtifactId("definition-a", "fixture-a"),
    ).toBe(workPatternFixtureArtifactId("definition-a", "fixture-a"));
    expect(
      workPatternFixtureArtifactId("definition-a", "fixture-a"),
    ).not.toBe(workPatternFixtureArtifactId("definition-a", "fixture-b"));
    expect(workPatternFixtureDigest(fixture)).toBe(
      workPatternFixtureDigest({ ...fixture }),
    );
    expect(workPatternFixtureDigest(fixture)).not.toBe(
      workPatternFixtureDigest({ ...fixture, objective: "Changed bytes." }),
    );
  });
});
