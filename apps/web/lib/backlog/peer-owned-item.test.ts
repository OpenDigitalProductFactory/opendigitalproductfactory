import { describe, expect, it, vi } from "vitest";

import { federatedWorkOriginMarker } from "@dpf/db/federated-work-contract";

import {
  PEER_OWNED_ERROR_CODE,
  peerOwnedStatusRefusal,
  peerOwnedStatusRefusalFor,
} from "./peer-owned-item";

// BI-C5794F1D: a work-sync mirror is owned by the installation it came from
// (spec 2026-08-23 §4 invariant 6). A local status write would be undone by the
// next pull, so it is refused, and the refusal names the owner.

const origin = `inst_${"a".repeat(32)}`;
const mirrorBody = `Peer text\n\n${federatedWorkOriginMarker(origin, "BI-PEER")}`;

describe("peerOwnedStatusRefusal", () => {
  it("refuses a mirrored item and names the owning installation", () => {
    const refusal = peerOwnedStatusRefusal("BI-PEER", mirrorBody);
    expect(refusal).toMatchObject({ error: PEER_OWNED_ERROR_CODE, originInstallationId: origin });
    expect(refusal!.message).toContain(`owned by installation ${origin}`);
    expect(refusal!.message).toContain("change it there");
    expect(refusal!.message).toContain("overwritten by work sync");
  });

  it("allows a locally owned item, including one whose prose only describes the marker", () => {
    expect(peerOwnedStatusRefusal("BI-OURS", "Ours")).toBeNull();
    expect(peerOwnedStatusRefusal("BI-OURS", null)).toBeNull();
    expect(peerOwnedStatusRefusal("BI-OURS", "Mirrors carry `[origin:federatedWork:<inst>:<id>]` inline.")).toBeNull();
  });
});

describe("peerOwnedStatusRefusalFor", () => {
  it("reads the item body by semantic id", async () => {
    const findUnique = vi.fn().mockResolvedValue({ body: mirrorBody });
    const refusal = await peerOwnedStatusRefusalFor({ backlogItem: { findUnique } }, "BI-PEER");
    expect(findUnique).toHaveBeenCalledWith({ where: { itemId: "BI-PEER" }, select: { body: true } });
    expect(refusal?.originInstallationId).toBe(origin);
  });

  it("leaves a missing item to the tool's own not-found handling", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    expect(await peerOwnedStatusRefusalFor({ backlogItem: { findUnique } }, "BI-NONE")).toBeNull();
  });
});
