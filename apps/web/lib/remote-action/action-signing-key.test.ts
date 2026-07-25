import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyEdgeActionEnvelope } from "../../../../packages/db/src/edge-action-envelope";
import { loadEdgeActionSigner } from "./action-signing-key";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("loadEdgeActionSigner", () => {
  it("fails closed when the private-key path or key id is absent", () => {
    expect(() => loadEdgeActionSigner({})).toThrow(/DPF_EDGE_ACTION_SIGNING_PRIVATE_KEY_FILE/);
    expect(() => loadEdgeActionSigner({ DPF_EDGE_ACTION_SIGNING_PRIVATE_KEY_FILE: "/missing" })).toThrow(/DPF_EDGE_ACTION_SIGNING_KEY_ID/);
  });

  it("loads an Ed25519 key from a host-mounted file and signs a verifiable envelope", () => {
    const dir = mkdtempSync(join(tmpdir(), "dpf-edge-action-key-"));
    dirs.push(dir);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const path = join(dir, "private.pem");
    writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });

    const signer = loadEdgeActionSigner({
      DPF_EDGE_ACTION_SIGNING_PRIVATE_KEY_FILE: path,
      DPF_EDGE_ACTION_SIGNING_KEY_ID: "edge-action-signing-v1",
    });
    const signed = signer.sign({
      version: "dpf.edge-action/1",
      signingKeyId: signer.signingKeyId,
      actionKey: "RA-1",
      nodeId: "edge_1",
      actionType: "inventory.collect",
      parameters: {},
      nonce: "nonce_0123456789abcdef",
      issuedAt: "2026-07-22T02:29:30.000Z",
      expiresAt: "2026-07-22T02:31:30.000Z",
    });
    expect(verifyEdgeActionEnvelope(signed, { publicKey, expectedNodeId: "edge_1", now: new Date("2026-07-22T02:30:00.000Z") })).toEqual({ ok: true, nonce: "nonce_0123456789abcdef" });
  });

  it("loads an encrypted Ed25519 key with a separately mounted password", () => {
    const dir = mkdtempSync(join(tmpdir(), "dpf-edge-action-key-"));
    dirs.push(dir);
    const { privateKey } = generateKeyPairSync("ed25519");
    const keyPath = join(dir, "private.pem");
    const passwordPath = join(dir, "password");
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: "test-password-0123456789" }), { mode: 0o600 });
    writeFileSync(passwordPath, "test-password-0123456789\n", { mode: 0o600 });

    expect(() => loadEdgeActionSigner({
      DPF_EDGE_ACTION_SIGNING_PRIVATE_KEY_FILE: keyPath,
      DPF_EDGE_ACTION_SIGNING_KEY_ID: "edge-action-signing-v1",
    })).toThrow();
    expect(loadEdgeActionSigner({
      DPF_EDGE_ACTION_SIGNING_PRIVATE_KEY_FILE: keyPath,
      DPF_EDGE_ACTION_SIGNING_PASSWORD_FILE: passwordPath,
      DPF_EDGE_ACTION_SIGNING_KEY_ID: "edge-action-signing-v1",
    }).signingKeyId).toBe("edge-action-signing-v1");
  });
});
