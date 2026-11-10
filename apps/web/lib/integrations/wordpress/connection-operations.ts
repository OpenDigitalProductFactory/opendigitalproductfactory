import { prisma } from "@dpf/db";

import { decryptJson } from "@/lib/govern/credential-crypto";
import {
  createConnectorCredentialStore,
  createPrismaConnectorCredentialRepository,
} from "@/lib/integrations/kernel/credential-store";
import { err, ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";

import { createWordPressClient, type WordPressProbe } from "./client";
import { projectWordPressProbe, type WordPressCredential } from "./connector";
import { readStoredWordPressCredential } from "./stored-credential";

const CONNECTION_ID = "wordpress-self-hosted";

type ConnectionDb = {
  integrationCredential: {
    findUnique(args: { where: { integrationId: string } }): Promise<{ status: string; fieldsEnc: string } | null>;
  };
};

type CredentialStore = Pick<
  ReturnType<typeof createConnectorCredentialStore>,
  "disconnect" | "recordHealthProbe" | "updateSafeProjection"
>;

type SafeProbe = Pick<WordPressProbe, "siteName" | "origin" | "supportedResourceKinds" | "canCreateDrafts" | "canPublishLive" | "canUploadMedia">;
type HealthResult = (ActionSuccess & SafeProbe) | ActionFailure;

function defaultCredentialStore(now?: () => Date): CredentialStore {
  return createConnectorCredentialStore({
    repository: createPrismaConnectorCredentialRepository(prisma as never),
    ...(now ? { now } : {}),
  });
}

export async function checkWordPressConnection(input: {
  db?: ConnectionDb;
  store?: CredentialStore;
  decrypt?: (stored: string) => unknown;
  createClient?: (input: { credential: WordPressCredential }) => Pick<ReturnType<typeof createWordPressClient>, "probe">;
  now?: () => Date;
} = {}): Promise<HealthResult> {
  const db = input.db ?? prisma as unknown as ConnectionDb;
  const row = await db.integrationCredential.findUnique({ where: { integrationId: CONNECTION_ID } });
  if (!row) return err("WordPress is not connected.");
  const credential = readStoredWordPressCredential((input.decrypt ?? decryptJson)(row.fieldsEnc));
  if (!credential) return err("Stored WordPress credential could not be read safely; reconnect the integration.");
  const store = input.store ?? defaultCredentialStore(input.now);
  try {
    const probe = await (input.createClient ?? ((value) => createWordPressClient(value)))({ credential }).probe();
    await store.recordHealthProbe(CONNECTION_ID, {
      succeeded: true,
      safeProjectionPatch: projectWordPressProbe(probe),
    });
    return Object.assign(ok(), {
      siteName: probe.siteName,
      origin: probe.origin,
      supportedResourceKinds: probe.supportedResourceKinds,
      canCreateDrafts: probe.canCreateDrafts,
      canPublishLive: probe.canPublishLive,
      canUploadMedia: probe.canUploadMedia,
    });
  } catch (error) {
    const candidate = error as { code?: string };
    const safeMessage = candidate.code === "authentication_failed"
      ? "WordPress rejected the Application Password."
      : candidate.code === "permission_denied"
        ? "The WordPress user lacks the required permissions."
        : "WordPress could not be reached safely.";
    await store.recordHealthProbe(CONNECTION_ID, {
      succeeded: false,
      error: {
        kind: candidate.code === "authentication_failed" ? "authentication" : candidate.code === "permission_denied" ? "authorization" : "network",
        safeMessage,
      },
    });
    return err(safeMessage);
  }
}

export async function disconnectWordPress(input: {
  db?: ConnectionDb;
  store?: CredentialStore;
} = {}): Promise<ActionSuccess & { revocationInstructions: string }> {
  const db = input.db ?? prisma as unknown as ConnectionDb;
  const row = await db.integrationCredential.findUnique({ where: { integrationId: CONNECTION_ID } });
  if (row) await (input.store ?? defaultCredentialStore()).disconnect(CONNECTION_ID);
  return Object.assign(ok(), {
    revocationInstructions: "In WordPress, open Users > Profile > Application Passwords and revoke the password created for DPF.",
  });
}

export async function setWordPressPublicationPolicy(input: {
  enabled: boolean;
  consequenceConfirmed: boolean;
  db?: ConnectionDb;
  store?: CredentialStore;
}): Promise<ActionSuccess & { publicPublicationEnabled: boolean }> {
  if (input.enabled && !input.consequenceConfirmed) {
    throw new Error("Confirm that enabling this policy permits approved content to become public on WordPress.");
  }
  const db = input.db ?? prisma as unknown as ConnectionDb;
  const row = await db.integrationCredential.findUnique({ where: { integrationId: CONNECTION_ID } });
  if (!row || row.status !== "connected") throw new Error("WordPress is not connected.");
  await (input.store ?? defaultCredentialStore()).updateSafeProjection(
    CONNECTION_ID,
    (safeProjection) => ({ ...safeProjection, publicPublicationEnabled: input.enabled }),
  );
  return Object.assign(ok(), { publicPublicationEnabled: input.enabled });
}
