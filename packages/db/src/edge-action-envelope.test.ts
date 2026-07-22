import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalizeEdgeActionEnvelope,
  signEdgeActionEnvelope,
  verifyEdgeActionEnvelope,
  type EdgeActionEnvelope,
} from "./edge-action-envelope";

const NOW = new Date("2026-07-22T02:30:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

function envelope(over: Partial<EdgeActionEnvelope> = {}): EdgeActionEnvelope {
  return {
    version: "dpf.edge-action/1",
    signingKeyId: "edge-action-signing-v1",
    actionKey: "RA-123",
    nodeId: "edge_mac_1",
    actionType: "inventory.collect",
    parameters: { include: ["os", "network"], nested: { z: 2, a: 1 } },
    nonce: "nonce_0123456789abcdef",
    issuedAt: "2026-07-22T02:29:30.000Z",
    expiresAt: "2026-07-22T02:31:30.000Z",
    ...over,
  };
}

describe("canonicalizeEdgeActionEnvelope", () => {
  it("is deterministic across object key order, including nested parameters", () => {
    const first = envelope();
    const reordered = {
      ...first,
      parameters: { nested: { a: 1, z: 2 }, include: ["os", "network"] },
    };
    expect(canonicalizeEdgeActionEnvelope(first)).toBe(canonicalizeEdgeActionEnvelope(reordered));
  });
});

describe("signed Edge action envelope", () => {
  it("accepts a valid signature for the expected node exactly once", () => {
    const body = envelope();
    const signed = signEdgeActionEnvelope(body, privateKey);
    const consumed = new Set<string>();

    expect(
      verifyEdgeActionEnvelope(signed, {
        publicKey,
        expectedNodeId: "edge_mac_1",
        now: NOW,
        hasConsumedNonce: (nonce) => consumed.has(nonce),
      }),
    ).toEqual({ ok: true, nonce: body.nonce });

    consumed.add(body.nonce);
    expect(
      verifyEdgeActionEnvelope(signed, {
        publicKey,
        expectedNodeId: "edge_mac_1",
        now: NOW,
        hasConsumedNonce: (nonce) => consumed.has(nonce),
      }),
    ).toEqual({ ok: false, reason: "nonce-already-consumed" });
  });

  it("rejects parameter tampering after signing", () => {
    const signed = signEdgeActionEnvelope(envelope(), privateKey);
    const tampered = { ...signed, parameters: { include: ["secrets"] } };
    expect(verifyEdgeActionEnvelope(tampered, { publicKey, expectedNodeId: "edge_mac_1", now: NOW })).toEqual({
      ok: false,
      reason: "invalid-signature",
    });
  });

  it("rejects an envelope bound to a different node", () => {
    const signed = signEdgeActionEnvelope(envelope(), privateKey);
    expect(verifyEdgeActionEnvelope(signed, { publicKey, expectedNodeId: "edge_windows_1", now: NOW })).toEqual({
      ok: false,
      reason: "wrong-node",
    });
  });

  it("rejects expired and excessively long-lived envelopes", () => {
    const expired = signEdgeActionEnvelope(envelope({ expiresAt: "2026-07-22T02:29:59.000Z" }), privateKey);
    expect(verifyEdgeActionEnvelope(expired, { publicKey, expectedNodeId: "edge_mac_1", now: NOW })).toEqual({
      ok: false,
      reason: "expired",
    });

    const tooLong = signEdgeActionEnvelope(envelope({ expiresAt: "2026-07-22T02:40:00.000Z" }), privateKey);
    expect(verifyEdgeActionEnvelope(tooLong, { publicKey, expectedNodeId: "edge_mac_1", now: NOW })).toEqual({
      ok: false,
      reason: "lifetime-too-long",
    });
  });
});
