import { randomBytes, randomUUID } from "node:crypto";
import { prisma, type Prisma, type AutomationPersonaProfile } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { currentUserContext, isCurrentUserActive } from "./current-user-context";
import { can } from "./permissions";
import { hashPassword } from "./password";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { loadEnvironmentClassResolution } from "@/lib/install/environment-class";
import { OAUTH_EXECUTION_AUTHORITY_SELECT, isCurrentOAuthExecutionAuthority } from "@/lib/auth/oauth-tokens";
import { getAgentToolGrantsAsync, grantsSatisfyRequirement } from "@/lib/agent-grants";

const ROLES: Record<AutomationPersonaProfile, string[]> = {
  platform_manager: ["HR-000"], developer: ["HR-200"], backlog_manager: ["HR-500"],
  employee: ["HR-600"], developer_backlog_manager: ["HR-200", "HR-500"],
};
export type FixtureRequest = { runId?: string; capsuleId?: string; leaseId?: string; profile: AutomationPersonaProfile; slot: number };
export type FixtureActor = { userId: string; agentId: string; apiTokenId?: string; authSource?: string; taskRunId?: string };
type RunAuthority = FixtureActor & { leaseId: string; expiresAt: string; taskRunId?: string };
const RUN_KIND = "ux";

export function parseFixtureRequest(input: unknown): FixtureRequest {
  if (!isRecord(input) || Object.keys(input).some(key => !["runId", "capsuleId", "leaseId", "profile", "slot"].includes(key))
    || typeof input.profile !== "string" || !Object.hasOwn(ROLES, input.profile)
    || !Number.isInteger(input.slot) || Number(input.slot) < 0 || Number(input.slot) > 1) {
    throw new Error("Choose a supported verification role and slot. Existing user identities cannot be selected.");
  }
  const existing = typeof input.runId === "string" && input.runId.length > 0;
  if (existing ? input.capsuleId !== undefined || input.leaseId !== undefined
    : typeof input.capsuleId !== "string" || !input.capsuleId || typeof input.leaseId !== "string" || !input.leaseId) {
    throw new Error("Use your verification run, or start one with your workroom and active verification lease.");
  }
  return input as FixtureRequest;
}

export function fixtureLifetime(now: Date, lease: Date, original?: Date): Date {
  const end = Math.min(now.getTime() + 2 * 3600_000, lease.getTime(), original?.getTime() ?? Infinity);
  if (!Number.isFinite(end) || end <= now.getTime()) throw new Error("This verification run has expired. Obtain a lease and start a new run.");
  return new Date(end);
}

async function requireFixtureEnvironment(db: Prisma.TransactionClient) {
  const resolution = await loadEnvironmentClassResolution({ readConfig: async key =>
    (await db.platformConfig.findUnique({ where: { key } }))?.value ?? null });
  if (!["development", "test"].includes(resolution.environmentClass)) {
    throw new Error("Isolated verification sign-in is available only on a development or test installation.");
  }
}

async function requireActor(actor: FixtureActor, roomId: string, db: Prisma.TransactionClient) {
  const human = await currentUserContext(actor.userId, db);
  if (!human || !can(human, "manage_platform") || !can(human, "manage_users") || !can(human, "manage_user_lifecycle")) {
    throw new Error("Your current permissions do not allow creating verification users. Ask an administrator to review your access.");
  }
  if (!actor.agentId || !grantsSatisfyRequirement(["sandbox_execute"], await getAgentToolGrantsAsync(actor.agentId))) {
    throw new Error("This assistant is not authorized to run verification.");
  }
  if (actor.authSource === "oauth") {
    const token = actor.apiTokenId ? await db.mcpApiToken.findUnique({ where: { id: actor.apiTokenId }, select: OAUTH_EXECUTION_AUTHORITY_SELECT }) : null;
    if (!token || token.userId !== actor.userId || token.agentId !== actor.agentId || !await isCurrentOAuthExecutionAuthority(token, db)) {
      throw new Error("This connection is no longer authorized. Review its access before starting another verification run.");
    }
  }
  const access = await resolveAgentWorkroomAccess({ userId: actor.userId, agentId: actor.agentId, workroomId: roomId, requested: "action" }, db);
  if (access.decision.level !== "action") throw new Error("You and your assistant must be admitted to this workroom before running verification.");
}

function readAuthority(value: unknown): RunAuthority {
  if (!isRecord(value) || !isRecord(value.fixture)) throw new Error("This is not an isolated verification run.");
  const v = value.fixture;
  if (typeof v.userId !== "string" || typeof v.agentId !== "string" || typeof v.leaseId !== "string" || typeof v.expiresAt !== "string") {
    throw new Error("The verification run has incomplete ownership. Start a new run.");
  }
  return v as RunAuthority;
}

function isFixtureRetired(result: unknown): boolean {
  return isRecord(result) && isRecord(result.fixtureCleanup) && result.fixtureCleanup.status === "retired";
}

async function requireLease(leaseId: string, room: { executorRef: string | null; headBranch: string | null; leaseExpiresAt: Date | null }, baseUrl: string, db: Prisma.TransactionClient) {
  const lease = await db.nonProductionEnvironmentLease.findUnique({ where: { leaseId } });
  if (!lease || lease.status !== "active" || lease.ownerSessionId !== room.executorRef || lease.branchName !== room.headBranch
    || !room.leaseExpiresAt || room.leaseExpiresAt <= new Date() || lease.expiresAt <= new Date()) {
    throw new Error("Use an active verification lease owned by this workroom on this installation.");
  }
  const origin = new URL(baseUrl).origin;
  if (new URL(lease.url).origin !== origin) {
    throw new Error(`Verification uses ${origin}. Claim a matching lease and retry; keep your MCP connection unchanged.`);
  }
  return new Date(Math.min(lease.expiresAt.getTime(), room.leaseExpiresAt.getTime()));
}

async function audit(db: Prisma.TransactionClient, actor: FixtureActor, runId: string, roomId: string, userId: string | null, action: string) {
  await db.adminActivity.create({ data: { userId: actor.userId, toolName: "issue_ux_verification_sign_in", tier: 2,
    result: "success", summary: `Verification ${action}`,
    parameters: { action, requesterUserId: actor.userId, requesterAgentId: actor.agentId, runId, workroomId: roomId, fixtureUserId: userId } } });
}

export async function prepareFixture(request: FixtureRequest, actor: FixtureActor, baseUrl: string) {
  return prisma.$transaction(async db => {
    await requireFixtureEnvironment(db);
    if (request.runId) await lockFixtureRun(db, request.runId);
    let run = request.runId ? await db.runtimeVerification.findUnique({ where: { verificationId: request.runId } }) : null;
    if (request.runId && (!run || run.kind !== RUN_KIND || run.status !== "running" || isFixtureRetired(run.result))) throw new Error("This verification run is closed or unavailable. Start a new run.");
    const room = await db.workroom.findUnique({ where: run?.workCapsuleId ? { id: run.workCapsuleId } : { capsuleId: request.capsuleId! } });
    if (!room) throw new Error("The verification workroom is unavailable.");
    await requireActor(actor, room.id, db);
    let authority = run ? readAuthority(run.result) : null;
    if (authority && (authority.userId !== actor.userId || authority.agentId !== actor.agentId || authority.taskRunId !== actor.taskRunId)) {
      throw new Error("This verification run belongs to another user, assistant or task. Start your own run.");
    }
    const leaseId = authority?.leaseId ?? request.leaseId!;
    const leaseExpiry = await requireLease(leaseId, room, baseUrl, db);
    const expiresAt = fixtureLifetime(new Date(), leaseExpiry, authority ? new Date(authority.expiresAt) : undefined);
    if (!run) {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))`;
      const existing = await db.runtimeVerification.findFirst({ where: { kind: RUN_KIND, workCapsuleId: room.id,
        command: `automation-fixture:${leaseId}` }, select: { verificationId: true } });
      if (existing) throw new Error(`This lease already has a verification run. Reuse run ${existing.verificationId}, or obtain a new lease for a fresh run.`);
      authority = { ...actor, leaseId, expiresAt: expiresAt.toISOString() };
      run = await db.runtimeVerification.create({ data: { verificationId: `RV-AUTO-${randomUUID()}`, kind: RUN_KIND,
        status: "running", workCapsuleId: room.id, command: `automation-fixture:${leaseId}`, startedAt: new Date(), result: { fixture: authority } } });
    }
    // Serialize same-run provisioning. Unique schema bounds five profiles x two slots.
    if (!request.runId) await lockFixtureRun(db, run.verificationId);
    let user = await db.user.findUnique({ where: { automationVerificationId_automationProfile_automationSlot: {
      automationVerificationId: run.id, automationProfile: request.profile, automationSlot: request.slot } } });
    if (!user) {
      const roles = await db.platformRole.findMany({ where: { roleId: { in: ROLES[request.profile] } }, select: { id: true, roleId: true } });
      if (roles.length !== ROLES[request.profile].length) throw new Error("Required verification roles are missing. Repair installation roles before retrying.");
      user = await db.user.create({ data: { email: `verification-${randomUUID()}@dpf.local`, passwordHash: await hashPassword(randomBytes(48).toString("base64url")),
        isSuperuser: false, isActive: true, automationVerificationId: run.id, automationProfile: request.profile,
        automationSlot: request.slot, automationExpiresAt: expiresAt,
        groups: { create: roles.map(role => ({ platformRoleId: role.id })) },
        employeeProfile: { create: { employeeId: `EMP-AUTO-${randomUUID()}`, firstName: "Verification", lastName: request.profile,
          displayName: `Verification ${request.profile}`, status: "active" } } } });
      await syncUserPrincipal(user.id, db as never);
    }
    if (!isCurrentUserActive(user) || user.isSuperuser) throw new Error("This verification user is disabled or expired. Start a new run.");
    await audit(db, actor, run.verificationId, room.id, user.id, "mint");
    return { userId: user.id, email: user.email, runId: run.verificationId, profile: request.profile, slot: request.slot,
      expiresAt: fixtureLifetime(new Date(), leaseExpiry, user.automationExpiresAt!), requestedBy: actor.userId };
  }, { timeout: 30_000 });
}

export async function validateFixtureExchange(userId: string, binding: { runId: string; profile: string; slot: number; requestedBy: string }, baseUrl: string) {
  return prisma.$transaction(async db => {
    await requireFixtureEnvironment(db);
    await lockFixtureRun(db, binding.runId);
    const user = await db.user.findUnique({ where: { id: userId }, include: { automationVerification: true } });
    const run = user?.automationVerification;
    if (!user || !run || run.kind !== RUN_KIND || run.status !== "running" || isFixtureRetired(run.result) || run.verificationId !== binding.runId
      || user.automationProfile !== binding.profile || user.automationSlot !== binding.slot || !isCurrentUserActive(user) || user.isSuperuser) {
      throw new Error("This verification sign-in has ended. Start a new authorized run.");
    }
    const actor = readAuthority(run.result);
    if (actor.userId !== binding.requestedBy || !run.workCapsuleId) throw new Error("The verification sign-in does not match its owner.");
    await requireActor(actor, run.workCapsuleId, db);
    const room = await db.workroom.findUniqueOrThrow({ where: { id: run.workCapsuleId } });
    const expiry = fixtureLifetime(new Date(), await requireLease(actor.leaseId, room, baseUrl, db), user.automationExpiresAt!);
    await audit(db, actor, run.verificationId, room.id, user.id, "exchange-admission");
    return expiry;
  });
}

/** Does not fabricate cancellation: an unsettled task keeps cleanup visibly pending. */
export async function retireFixtureRun(runId: string, actor?: FixtureActor) {
  return prisma.$transaction(async db => {
    await lockFixtureRun(db, runId);
    const run = await db.runtimeVerification.findUnique({ where: { verificationId: runId } });
    if (!run || run.kind !== RUN_KIND || !run.workCapsuleId) throw new Error("The verification run is unavailable.");
    const owner = readAuthority(run.result);
    if (actor) {
      if (owner.userId !== actor.userId || owner.agentId !== actor.agentId || owner.taskRunId !== actor.taskRunId) throw new Error("This verification run belongs to another user, assistant or task.");
      await requireActor(actor, run.workCapsuleId, db);
    } else if (new Date(owner.expiresAt) > new Date()) {
      throw new Error("Automatic cleanup cannot retire an unexpired run.");
    }
    if (isFixtureRetired(run.result)) return { retired: true, alreadyRetired: true, pendingTaskIds: [] as string[] };
    const users = await db.user.findMany({ where: { automationVerificationId: run.id }, select: { id: true } });
    const ids = users.map(user => user.id);
    const tasks = await db.taskRun.findMany({ where: { userId: { in: ids }, status: { notIn: ["completed", "failed", "canceled", "rejected", "archived"] } },
      select: { taskRunId: true }, take: 100 });
    if (tasks.length) {
      await audit(db, owner, runId, run.workCapsuleId, null, "cleanup-pending-task-settlement");
      return { retired: false, pendingTaskIds: tasks.map(task => task.taskRunId) };
    }
    const aliases = await db.principalAlias.findMany({ where: { aliasType: "user", aliasValue: { in: ids }, issuer: "" }, select: { principalId: true } });
    const principalIds = aliases.map(alias => alias.principalId);
    const rooms = await db.workroom.findMany({ where: { OR: [{ requestedByPrincipalId: { in: principalIds } }, { createdByPrincipalId: { in: principalIds } }],
      status: { notIn: ["complete", "abandoned", "archived"] } }, select: { capsuleId: true }, take: 100 });
    if (rooms.length) {
      await audit(db, owner, runId, run.workCapsuleId, null, "cleanup-pending-room-closure");
      return { retired: false, pendingTaskIds: [] as string[], pendingRoomIds: rooms.map(room => room.capsuleId) };
    }
    const now = new Date();
    await db.authorityBinding.updateMany({ where: { oauthUserId: { in: ids }, oauthPurpose: { not: null } }, data: { status: "revoked" } });
    await db.mcpApiToken.updateMany({ where: { userId: { in: ids }, revokedAt: null }, data: { revokedAt: now } });
    await db.oAuthRefreshToken.updateMany({ where: { userId: { in: ids }, revokedAt: null }, data: { revokedAt: now } });
    await db.user.updateMany({ where: { id: { in: ids }, automationVerificationId: run.id }, data: { isActive: false } });
    await db.principal.updateMany({ where: { id: { in: principalIds } }, data: { status: "inactive" } });
    await audit(db, owner, runId, run.workCapsuleId, null, "cleanup-complete");
    // Cleanup is not a UX verdict. Keep real outcomes and use the existing
    // result for lifecycle idempotence. A concurrent verifier changes updatedAt
    // and rolls this transaction back rather than losing its result.
    await db.runtimeVerification.update({ where: { id: run.id, updatedAt: run.updatedAt, status: run.status,
      result: { equals: run.result as Prisma.InputJsonValue } }, data: {
      ...(run.status === "running" ? { status: "skipped", completedAt: now } : {}),
      result: { ...(isRecord(run.result) ? run.result : {}), fixtureCleanup: { status: "retired", retiredAt: now.toISOString() } } as Prisma.InputJsonObject,
    } });
    return { retired: true, alreadyRetired: false, pendingTaskIds: [] as string[] };
  });
}

/** All fixture lifecycle writers serialize before reading mutable run state. */
async function lockFixtureRun(db: Prisma.TransactionClient, runId: string) {
  const key = `automation-fixture:${runId}`;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Bounded indexed scan; a persisted cursor prevents a blocked first run starving later runs. */
export async function retireExpiredFixtures() {
  const key = "automation.fixture.cleanup-cursor";
  const stored = await prisma.platformConfig.findUnique({ where: { key } });
  const cursor = isRecord(stored?.value) && typeof stored.value.id === "string" && typeof stored.value.expiry === "string"
    ? { id: stored.value.id, expiry: new Date(stored.value.expiry) } : null;
  const users = await prisma.user.findMany({ where: { automationExpiresAt: { lte: new Date() }, isActive: true,
    ...(cursor ? { OR: [{ automationExpiresAt: { gt: cursor.expiry } }, { automationExpiresAt: cursor.expiry, id: { gt: cursor.id } }] } : {}) },
    orderBy: [{ automationExpiresAt: "asc" }, { id: "asc" }], take: 100,
    select: { id: true, automationExpiresAt: true, automationVerification: { select: { verificationId: true } } } });
  const outcomes = [];
  for (const runId of new Set(users.flatMap(user => user.automationVerification ? [user.automationVerification.verificationId] : []))) {
    outcomes.push({ runId, ...await retireFixtureRun(runId) });
  }
  const last = users.length === 100 ? users.at(-1) : null;
  const value = last ? { id: last.id, expiry: last.automationExpiresAt!.toISOString() } : {};
  await prisma.platformConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  return { scanned: users.length, outcomes };
}
