import { describe, expect, it } from "vitest";

import {
  buildDevPortalTargetInput,
  buildRootPortalTargetInput,
  buildRuntimeTargetBackfillInputs,
} from "./backfill";

describe("runtime target seed inputs", () => {
  it("projects the root portal and dev portal into slim runtime target inputs", () => {
    expect(buildRootPortalTargetInput({
      appUrl: "http://localhost:3000",
      serviceVersion: "image:07133d5e git:07133d5e",
    })).toMatchObject({
      targetId: "RT-ROOT-PORTAL",
      kind: "root-portal",
      status: "running",
      serviceName: "portal",
      containerName: "dpf-portal-1",
      hostUrl: "http://localhost:3000",
      port: 3000,
      serviceVersion: "image:07133d5e git:07133d5e",
    });

    expect(buildDevPortalTargetInput()).toMatchObject({
      targetId: "RT-DEV-PORTAL",
      kind: "dev-portal",
      status: "planned",
      serviceName: "dev-portal",
      port: 3001,
    });
  });
});

describe("buildRuntimeTargetBackfillInputs", () => {
  it("mirrors live sandboxes and marks phantom sandbox slots as misconfigured", () => {
    const inputs = buildRuntimeTargetBackfillInputs({
      existingTargetIds: new Set(["RT-SANDBOX-existing"]),
      featureBuildsByBuildId: new Map([
        ["FB-1", { id: "feature-build-row-1", buildId: "FB-1" }],
      ]),
      runningContainerIds: new Set(["dpf-sandbox-1"]),
      sandboxes: [
        {
          id: "sandbox-row-1",
          buildId: "FB-1",
          providerId: "local-docker",
          state: "running",
          previewUrl: "http://localhost:3035",
        },
      ],
      sandboxSlots: [
        {
          id: "slot-row-1",
          slotIndex: 0,
          containerId: "dpf-sandbox-1",
          port: 3035,
          status: "available",
          buildId: null,
        },
        {
          id: "slot-row-2",
          slotIndex: 1,
          containerId: "dpf-sandbox-2",
          port: 3037,
          status: "available",
          buildId: null,
        },
      ],
      gitPromotionCandidates: [
        {
          id: "candidate-row-1",
          candidateId: "GPC-1",
          status: "verifying",
          sandboxId: "sandbox-row-2",
        },
      ],
    });

    expect(inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "RT-SANDBOX-sandbox-row-1",
        kind: "build-sandbox",
        status: "running",
        sandboxId: "sandbox-row-1",
        featureBuildId: "feature-build-row-1",
        hostUrl: "http://localhost:3035",
      }),
      expect.objectContaining({
        targetId: "RT-SANDBOX-SLOT-slot-row-2",
        kind: "build-sandbox",
        status: "misconfigured",
        slotId: "slot-row-2",
        containerName: "dpf-sandbox-2",
        port: 3037,
      }),
      expect.objectContaining({
        targetId: "RT-GIT-PROMOTION-candidate-row-1",
        kind: "git-promotion-sandbox",
        status: "verifying",
        sandboxId: "sandbox-row-2",
      }),
    ]));
    expect(inputs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "RT-SANDBOX-SLOT-slot-row-1" }),
      expect.objectContaining({ targetId: "RT-SANDBOX-existing" }),
    ]));
  });
});
