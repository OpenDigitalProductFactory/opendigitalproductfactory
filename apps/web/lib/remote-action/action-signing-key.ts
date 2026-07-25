import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";

import { signEdgeActionEnvelope } from "@dpf/db/edge-action-envelope";

import type { EdgeActionEnvelopeSigner } from "./dispatch-orchestrator";

type SigningEnvironment = Record<string, string | undefined>;

export function loadEdgeActionSigner(env: SigningEnvironment = process.env): EdgeActionEnvelopeSigner {
  const path = env.DPF_EDGE_ACTION_SIGNING_PRIVATE_KEY_FILE?.trim();
  if (!path) throw new Error("DPF_EDGE_ACTION_SIGNING_PRIVATE_KEY_FILE is required when Edge action dispatch is enabled");
  const signingKeyId = env.DPF_EDGE_ACTION_SIGNING_KEY_ID?.trim();
  if (!signingKeyId) throw new Error("DPF_EDGE_ACTION_SIGNING_KEY_ID is required when Edge action dispatch is enabled");

  const passwordPath = env.DPF_EDGE_ACTION_SIGNING_PASSWORD_FILE?.trim();
  const privateKey = passwordPath
    ? createPrivateKey({ key: readFileSync(path), format: "pem", passphrase: readFileSync(passwordPath, "utf8").trim() })
    : createPrivateKey(readFileSync(path));
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Edge action signing key must be Ed25519");
  }
  return {
    signingKeyId,
    sign(envelope) {
      if (envelope.signingKeyId !== signingKeyId) throw new Error("Edge action signing key id mismatch");
      return signEdgeActionEnvelope(envelope, privateKey);
    },
  };
}
