// node --test — matches the bare-runner CI test job that gates scripts/.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planSlotImageReaping,
  reapSupersededSlotImages,
  slotImagePrefix,
} from "./local-integration-image-retention.mjs";

describe("slotImagePrefix", () => {
  it("scopes to the slot when a slot key is given", () => {
    assert.equal(slotImagePrefix("slot-0"), "dpf-local-integration-slot-0-");
  });

  it("falls back to the bare namespace without a slot key", () => {
    assert.equal(slotImagePrefix(""), "dpf-local-integration-");
  });
});

describe("planSlotImageReaping", () => {
  it("reaps older images for the slot and keeps the new one", () => {
    const images = [
      "dpf-local-integration-slot-0-feat-old-one-build",
      "dpf-local-integration-slot-0-feat-old-two-build",
      "dpf-local-integration-slot-0-feat-new-build",
    ];
    assert.deepEqual(
      planSlotImageReaping({ images, slotKey: "slot-0", keepTag: "dpf-local-integration-slot-0-feat-new-build" }),
      [
        "dpf-local-integration-slot-0-feat-old-one-build",
        "dpf-local-integration-slot-0-feat-old-two-build",
      ],
    );
  });

  it("never reaps another slot's images", () => {
    const images = [
      "dpf-local-integration-slot-0-feat-old-build",
      "dpf-local-integration-slot-1-feat-live-build",
    ];
    assert.deepEqual(
      planSlotImageReaping({ images, slotKey: "slot-0", keepTag: "dpf-local-integration-slot-0-feat-new-build" }),
      ["dpf-local-integration-slot-0-feat-old-build"],
    );
  });

  it("an unslotted build leaves slot-scoped images alone", () => {
    // The bare prefix is a substring of every slot tag; without this guard an
    // unslotted build would reap the live images of every concurrent slot.
    const images = [
      "dpf-local-integration-feat-old-build",
      "dpf-local-integration-slot-0-feat-live-build",
      "dpf-local-integration-slot-3-feat-live-build",
    ];
    assert.deepEqual(
      planSlotImageReaping({ images, keepTag: "dpf-local-integration-feat-new-build" }),
      ["dpf-local-integration-feat-old-build"],
    );
  });

  it("ignores unrelated images", () => {
    const images = ["dpf-portal", "dpf-sandbox", "postgres:16", "dpf-promoter"];
    assert.deepEqual(
      planSlotImageReaping({ images, slotKey: "slot-0", keepTag: "dpf-local-integration-slot-0-feat-new-build" }),
      [],
    );
  });

  it("returns nothing when the kept tag is the only image", () => {
    assert.deepEqual(
      planSlotImageReaping({
        images: ["dpf-local-integration-slot-0-feat-new-build"],
        slotKey: "slot-0",
        keepTag: "dpf-local-integration-slot-0-feat-new-build",
      }),
      [],
    );
  });

  it("tolerates empty and malformed entries", () => {
    assert.deepEqual(
      planSlotImageReaping({ images: ["", null, undefined, 42], slotKey: "slot-0", keepTag: "x" }),
      [],
    );
  });
});

describe("reapSupersededSlotImages", () => {
  const images = [
    "dpf-local-integration-slot-0-feat-old-build",
    "dpf-local-integration-slot-0-feat-new-build",
  ];

  it("removes superseded images and reports them", () => {
    const removed = [];
    const result = reapSupersededSlotImages({
      slotKey: "slot-0",
      keepTag: "dpf-local-integration-slot-0-feat-new-build",
      listImages: () => images,
      removeImage: (tag) => removed.push(tag),
    });
    assert.deepEqual(removed, ["dpf-local-integration-slot-0-feat-old-build"]);
    assert.deepEqual(result.removed, ["dpf-local-integration-slot-0-feat-old-build"]);
    assert.deepEqual(result.failed, []);
  });

  it("does nothing without a kept tag, so a failed build reaps nothing", () => {
    // Retention must only run after a build that produced a working image.
    // Reaping on failure would delete the last good image for the slot.
    let called = false;
    const result = reapSupersededSlotImages({
      slotKey: "slot-0",
      keepTag: "",
      listImages: () => { called = true; return images; },
      removeImage: () => assert.fail("must not remove anything"),
    });
    assert.equal(called, false);
    assert.deepEqual(result.planned, []);
  });

  it("survives a docker listing failure without throwing", () => {
    const result = reapSupersededSlotImages({
      slotKey: "slot-0",
      keepTag: "dpf-local-integration-slot-0-feat-new-build",
      listImages: () => { throw new Error("docker daemon unreachable"); },
      removeImage: () => assert.fail("must not remove anything"),
    });
    assert.deepEqual(result.planned, []);
    assert.deepEqual(result.removed, []);
  });

  it("records a removal failure without aborting the rest", () => {
    const result = reapSupersededSlotImages({
      slotKey: "slot-0",
      keepTag: "dpf-local-integration-slot-0-keep-build",
      listImages: () => [
        "dpf-local-integration-slot-0-a-build",
        "dpf-local-integration-slot-0-b-build",
      ],
      removeImage: (tag) => {
        if (tag.endsWith("-a-build")) throw new Error("image is in use");
      },
    });
    assert.deepEqual(result.removed, ["dpf-local-integration-slot-0-b-build"]);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].tag, "dpf-local-integration-slot-0-a-build");
  });
});
