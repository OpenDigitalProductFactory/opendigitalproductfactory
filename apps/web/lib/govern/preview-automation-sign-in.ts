import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDatabaseClient, prisma } from "@dpf/db";
import { mintAutomationSignIn, type AutomationSignInDb } from "./automation-sign-in";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { workCapsuleActor } from "@/lib/work-capsules/handler-actor";

const exec = promisify(execFile);
export type PreviewAdmission = {
  leaseId: string; ownerSessionId: string; status: string; expiresAt: Date;
  worktreePath: string | null; branchName: string | null; url: string;
};
export function assertPreviewAdmission(lease: PreviewAdmission | null, ownerSessionId: string, now: Date): asserts lease is PreviewAdmission {
  if (!lease || lease.status !== "active" || lease.expiresAt <= now || lease.ownerSessionId !== ownerSessionId
      || !lease.worktreePath || !lease.branchName) throw new Error("preview_not_admitted_for_session");
  const url = new URL(lease.url);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)
      || url.port !== "3001" || url.username || url.password || url.pathname !== "/") throw new Error("preview_origin_not_canonical");
}
export function assertPreviewIssuerContainer(container: {
  Config?: { Labels?: Record<string, string>; Env?: string[] };
  Mounts?: Array<{ Type: string; Source: string; Destination: string }>;
  State?: { Running?: boolean };
  NetworkSettings?: { Ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null> };
}, lease: PreviewAdmission, sha: string) {
  const labels = container.Config?.Labels;
  const ports = container.NetworkSettings?.Ports?.["3000/tcp"];
  const mount = container.Mounts?.find(item => item.Destination === "/workspace");
  if (!ports?.length || ports.some(port => port.HostPort !== "3001" || !["127.0.0.1", "::1"].includes(port.HostIp))
      || !container.State?.Running || labels?.["com.docker.compose.service"] !== "dev-portal"
      || labels?.["dpf.preview.lease"] !== lease.leaseId || labels?.["dpf.preview.sha"] !== sha
      || mount?.Type !== "bind" || mount.Source !== lease.worktreePath
      || !container.Config?.Env?.includes("DPF_ENVIRONMENT_CLASS=development")) throw new Error("preview_issuer_binding_mismatch");
}

export async function issuePreviewAutomationSignIn(input: {
  leaseId: string; ownerSessionId: string; nextPath?: string; userId: string;
  context?: { agentId?: string; authSource?: string };
}) {
  const lease = await prisma.nonProductionEnvironmentLease.findUnique({ where: { leaseId: input.leaseId } });
  assertPreviewAdmission(lease, input.ownerSessionId, new Date());
  const actor = await workCapsuleActor(input.userId, input.context);
  if (!actor.principalId) throw new Error("preview_principal_unverified");
  // A session string alone grants nothing. The authenticated principal must
  // own the source Workroom, at its recorded commit and executor session.
  const room = await prisma.workroom.findFirst({ where: {
    worktreePath: lease.worktreePath, headBranch: lease.branchName,
    executorRef: input.ownerSessionId, leaseHolderPrincipalId: actor.principalId,
    leaseExpiresAt: { gt: new Date() }, archivedAt: null,
  }, select: { headSha: true } });
  if (!room?.headSha || !/^[a-f0-9]{40}$/.test(room.headSha)) throw new Error("preview_source_workroom_unverified");
  const listed = await exec("docker", ["ps", "-q", "--filter", `label=dpf.preview.lease=${lease.leaseId}`, "--filter", "label=com.docker.compose.service=dev-portal"], { timeout: 10000 });
  const ids = listed.stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.length !== 1 || !/^[a-f0-9]{12,64}$/.test(ids[0]!)) throw new Error("preview_issuer_unavailable");
  const inspected = await exec("docker", ["inspect", ids[0]!], { timeout: 10000, maxBuffer: 1024 * 1024 });
  const [container] = JSON.parse(inspected.stdout);
  assertPreviewIssuerContainer(container, lease, room.headSha);
  // The canonical platform owns issuance. It uses the inspected preview's
  // disposable DB and signing identity, so an older preserved feature tree
  // needs no new bootstrap script or source changes to obtain a session.
  const environment: Record<string, string> = Object.fromEntries((container.Config.Env as string[]).map(item => {
    const separator = item.indexOf("=");
    return [item.slice(0, separator), item.slice(separator + 1)];
  }));
  const databaseUrl = environment["DATABASE_URL"];
  const destination = databaseUrl ? new URL(databaseUrl) : null;
  if (!destination || !["postgresql:", "postgres:"].includes(destination.protocol)
      || destination.hostname !== "dev-postgres" || destination.port !== "5432"
      || destination.pathname !== "/dpf" || destination.search || destination.hash || !environment["AUTH_SECRET"]
      || environment["AUTH_SECRET"].length < 32) throw new Error("preview_issuer_prerequisites_missing");
  const db = createDatabaseClient(databaseUrl);
  let result;
  try {
    result = await mintAutomationSignIn({ nextPath: input.nextPath, baseUrl: lease.url,
      requestedBy: `preview:${lease.leaseId}:${actor.principalId}` }, {
      db: db as unknown as AutomationSignInDb, env: environment, syncPrincipal: userId => syncUserPrincipal(userId, db),
    });
  } finally { await db.$disconnect(); }
  assertPreviewAdmission(await prisma.nonProductionEnvironmentLease.findUnique({ where: { leaseId: input.leaseId } }), input.ownerSessionId, new Date());
  if (!result.issued || new URL(result.url).origin !== new URL(lease.url).origin) throw new Error("preview_sign_in_not_issued");
  return { ...result, previewIdentity: { sourceSha: room.headSha, leaseId: lease.leaseId, baseUrl: lease.url } };
}
