/**
 * Repository-controller fencing for inbound issue intake (BI-FD40397B AC-1,
 * spec 2026-09-16 §6.1 "AC-1 controller predicate").
 *
 * An `evolve-dpf` purpose alone does not prove this installation owns the DPF
 * repository's issue follow-through. The runner (before every run) and the
 * commissioning action (before writing the reference) evaluate ONE predicate:
 *
 *   commission ref → live, non-terminal Workroom → issue-triage-watch@1.0.0 →
 *   locally owned (not a federated mirror) → explicit upstream repository that
 *   matches the room and the commission → an active local owner, and the
 *   commissioning principal still one of them → a DECLARED production install →
 *   a valid, confirmed evolve-dpf operating intent.
 *
 * Any failed clause is `not commissioned: <reason>`. This is local controller
 * fencing, not a distributed lock across independent installations.
 */

import { hasFederatedWorkOriginMarker } from "@dpf/db/federated-work-contract";

import { parseRepoFromUrl, type RepoIdentity } from "@/lib/contributor-change-lanes/github-rest-reader";
import {
  loadInstallationOperatingIntent,
  type InstallationIntentDb,
  type LoadedInstallationOperatingIntent,
} from "@/lib/installation-journey/operating-intent";
import { ECOSYSTEM_JOB_CATALOG_ENTRIES } from "@/lib/operate/scheduled-jobs/catalog-ecosystem";
import {
  INTAKE_CONTROLLER_JOB_ID,
  INTAKE_CONTROLLER_WORK_SHAPE,
  mergeIntakeControllerCommission,
  parseIntakeControllerCommission,
  type IntakeControllerCommission,
} from "@/lib/operate/scheduled-jobs/intake-controller-commission";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";
import { readWorkShapeClaimRef } from "@/lib/work-management/workroom-shape-claim";

const REQUIRED_PURPOSE = "evolve-dpf";
const OWNER_ROLES = new Set(["accountable", "coordinator"]);
/** A federated room participant is minted with this kind (ensureFederatedRoomPrincipal). */
const FOREIGN_PRINCIPAL_KIND = "external-agent";

export interface IntakeControllerParticipant {
  /** Relational Principal.id. */
  principalId: string;
  roles: string[];
  lifecycle: string;
  principal: { kind: string; status: string } | null;
}

export interface IntakeControllerWorkroom {
  capsuleId: string;
  status: string;
  archivedAt: Date | null;
  repositoryFullName: string | null;
  scopeClaims: unknown;
  participants: IntakeControllerParticipant[];
}

export interface IntakeControllerEnvironment {
  environmentClass: string;
  /** False when every tier was silent and only the cautious default applied. */
  declared: boolean;
}

export interface IntakeControllerFacts {
  commission: IntakeControllerCommission | null;
  workroom: IntakeControllerWorkroom | null;
  /** True when the room, or the backlog item it is bound to, mirrors peer-owned work. */
  mirroredFromPeer: boolean;
  upstreamRemoteUrl: string | null;
  intent: LoadedInstallationOperatingIntent;
  environment: IntakeControllerEnvironment;
}

export type IntakeControllerVerdict =
  | { ok: true; repo: RepoIdentity; workroomCapsuleId: string }
  | { ok: false; reason: string };

const refuse = (reason: string): IntakeControllerVerdict => ({ ok: false, reason: `not commissioned: ${reason}` });
const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const fullName = (repo: RepoIdentity) => `${repo.owner}/${repo.name}`;

function isLocalOwner(participant: IntakeControllerParticipant): boolean {
  return participant.lifecycle === "active"
    && participant.roles.some((role) => OWNER_ROLES.has(role))
    && participant.principal?.status === "active"
    && participant.principal.kind !== FOREIGN_PRINCIPAL_KIND;
}

/** The single AC-1 predicate. Pure. */
export function evaluateIntakeControllerAuthority(facts: IntakeControllerFacts): IntakeControllerVerdict {
  const { commission, workroom } = facts;
  if (!commission) {
    return refuse(
      `no controller workroom is referenced on ${INTAKE_CONTROLLER_JOB_ID}; `
      + `commission an ${INTAKE_CONTROLLER_WORK_SHAPE} workroom owned on this installation`,
    );
  }
  const id = commission.workroomCapsuleId;
  if (!workroom) return refuse(`workroom ${id} was not found`);
  if (workroom.archivedAt) return refuse(`workroom ${id} is archived`);
  if (TERMINAL_WORKROOM_STATUSES.has(workroom.status)) return refuse(`workroom ${id} is ${workroom.status}`);

  const shape = readWorkShapeClaimRef(workroom.scopeClaims);
  if (shape !== INTAKE_CONTROLLER_WORK_SHAPE) {
    return refuse(`workroom ${id} declares ${shape ?? "no work shape"}, not ${INTAKE_CONTROLLER_WORK_SHAPE}`);
  }
  if (facts.mirroredFromPeer) return refuse(`workroom ${id} mirrors peer-owned work and is not locally owned`);

  if (!facts.upstreamRemoteUrl) {
    return refuse("no explicit upstream repository is configured (PlatformDevConfig.upstreamRemoteUrl)");
  }
  const repo = parseRepoFromUrl(facts.upstreamRemoteUrl);
  if (!repo) return refuse("the configured upstream URL is not a GitHub repository");
  if (!workroom.repositoryFullName || !sameRepo(workroom.repositoryFullName, fullName(repo))) {
    return refuse(
      `workroom ${id} is for ${workroom.repositoryFullName ?? "no repository"}, `
      + `not the configured upstream ${fullName(repo)}`,
    );
  }
  if (!sameRepo(commission.repositoryFullName, fullName(repo))) {
    return refuse(`the commission names ${commission.repositoryFullName}, not the configured upstream ${fullName(repo)}`);
  }

  const owners = workroom.participants.filter(isLocalOwner);
  if (owners.length === 0) return refuse(`workroom ${id} has no active local accountable or coordinator owner`);
  if (!owners.some((owner) => owner.principalId === commission.commissionedByPrincipalId)) {
    return refuse(`the commissioning principal no longer owns workroom ${id}`);
  }

  // Install identity (operator decision 2026-10-13): only a DECLARED production
  // install may hold the controller; a DEV peer cannot, even with a local room.
  if (facts.environment.environmentClass !== "production") return refuse("installation is not a production install");
  if (!facts.environment.declared) return refuse("installation is not a production install (environment class undeclared)");

  const { intent } = facts;
  if (intent.status !== "valid") return refuse(`installation operating intent is ${intent.status}`);
  if (intent.intent.confirmation.status !== "confirmed") {
    return refuse(`installation operating intent is not confirmed (${intent.intent.confirmation.status})`);
  }
  if (intent.intent.primaryPurpose !== REQUIRED_PURPOSE) {
    return refuse(`installation purpose is ${intent.intent.primaryPurpose}, not ${REQUIRED_PURPOSE}`);
  }
  return { ok: true, repo, workroomCapsuleId: workroom.capsuleId };
}

// ── impure edge ───────────────────────────────────────────────────────────────

type WorkroomRow = IntakeControllerWorkroom & { id: string; backlogItemId: string | null };

/** The narrow Prisma surface this module reads and writes; a test double fits it. */
export interface IntakeControllerDb {
  scheduledJob: {
    findUnique(args: unknown): Promise<{ metadata: unknown } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  workroom: { findFirst(args: unknown): Promise<WorkroomRow | null> };
  federatedRecordMirror: { findFirst(args: unknown): Promise<{ mirrorId: string } | null> };
  backlogItem: { findFirst(args: unknown): Promise<{ body: string | null } | null> };
  platformDevConfig: { findUnique(args: unknown): Promise<{ upstreamRemoteUrl: string | null } | null> };
  platformConfig: { findUnique(args: unknown): Promise<{ value: unknown } | null> };
}

export interface IntakeControllerDeps {
  db?: IntakeControllerDb;
  /** Environment class from the instance-stance precedence chain. */
  loadEnvironment?: () => Promise<IntakeControllerEnvironment>;
}

async function defaultDb(): Promise<IntakeControllerDb> {
  const { prisma } = await import("@dpf/db");
  return prisma as unknown as IntakeControllerDb;
}

/** Reuses the resolver behind loadInstanceStance (and so get_my_coworker_profile). */
function environmentLoader(db: IntakeControllerDb): () => Promise<IntakeControllerEnvironment> {
  return async () => {
    const { loadEnvironmentClassResolution } = await import("@/lib/install/environment-class");
    const resolution = await loadEnvironmentClassResolution({
      readConfig: async (key: string) =>
        (await db.platformConfig.findUnique({ where: { key }, select: { value: true } }))?.value ?? null,
    });
    return { environmentClass: resolution.environmentClass, declared: resolution.declared };
  };
}

async function loadWorkroom(db: IntakeControllerDb, capsuleId: string): Promise<WorkroomRow | null> {
  return db.workroom.findFirst({
    where: { OR: [{ capsuleId }, { id: capsuleId }] },
    select: {
      id: true,
      capsuleId: true,
      status: true,
      archivedAt: true,
      repositoryFullName: true,
      scopeClaims: true,
      backlogItemId: true,
      participants: {
        select: { principalId: true, roles: true, lifecycle: true, principal: { select: { kind: true, status: true } } },
      },
    },
  });
}

/** Peer-owned work: a peer-canonical mirror of the room, or a room bound to a federated-work mirror item. */
async function isMirroredFromPeer(db: IntakeControllerDb, room: WorkroomRow): Promise<boolean> {
  const mirror = await db.federatedRecordMirror.findFirst({
    where: { canonicalSide: "peer", localRecordRef: { in: [room.id, room.capsuleId] } },
    select: { mirrorId: true },
  });
  if (mirror) return true;
  if (!room.backlogItemId) return false;
  // Writers store either the semantic BI-* key or the row id (BI-640B011D).
  const item = await db.backlogItem.findFirst({
    where: { OR: [{ itemId: room.backlogItemId }, { id: room.backlogItemId }] },
    select: { body: true },
  });
  return hasFederatedWorkOriginMarker(item?.body);
}

async function loadFacts(
  db: IntakeControllerDb,
  commission: IntakeControllerCommission,
  loadEnvironment: () => Promise<IntakeControllerEnvironment>,
): Promise<IntakeControllerFacts> {
  const intentDb = { platformConfig: db.platformConfig } as unknown as InstallationIntentDb;
  const [workroom, config, intent, environment] = await Promise.all([
    loadWorkroom(db, commission.workroomCapsuleId),
    db.platformDevConfig.findUnique({ where: { id: "singleton" }, select: { upstreamRemoteUrl: true } }),
    loadInstallationOperatingIntent(intentDb),
    loadEnvironment(),
  ]);
  return {
    commission,
    workroom,
    mirroredFromPeer: workroom ? await isMirroredFromPeer(db, workroom) : false,
    upstreamRemoteUrl: config?.upstreamRemoteUrl ?? null,
    intent,
    environment,
  };
}

/** Runner default: resolve and re-validate the commission recorded on the scheduled job. */
export async function loadIntakeControllerCommission(deps: IntakeControllerDeps = {}): Promise<IntakeControllerVerdict> {
  const db = deps.db ?? (await defaultDb());
  const row = await db.scheduledJob.findUnique({ where: { jobId: INTAKE_CONTROLLER_JOB_ID }, select: { metadata: true } });
  const commission = parseIntakeControllerCommission(row?.metadata);
  if (!commission) {
    // Absence is the answer; nothing else needs loading to refuse.
    return evaluateIntakeControllerAuthority({
      commission: null,
      workroom: null,
      mirroredFromPeer: false,
      upstreamRemoteUrl: null,
      intent: { status: "missing" },
      environment: { environmentClass: "unknown", declared: false },
    });
  }
  return evaluateIntakeControllerAuthority(
    await loadFacts(db, commission, deps.loadEnvironment ?? environmentLoader(db)),
  );
}

export type CommissionIntakeControllerResult =
  | { ok: true; commission: IntakeControllerCommission }
  | { ok: false; reason: string };

/**
 * Write the commission reference after validating the same predicate the runner
 * enforces, with the acting principal as the commissioner — so only a current
 * local owner of the room can commission it. The caller authenticates the user
 * and checks platform-management authority (lib/actions/scheduled-jobs.ts).
 */
export async function commissionIntakeController(input: IntakeControllerDeps & {
  workroomCapsuleId: string;
  /** Relational Principal.id of the acting user's active human principal. */
  principalRecordId: string;
  now?: Date;
}): Promise<CommissionIntakeControllerResult> {
  try {
    const db = input.db ?? (await defaultDb());
    const now = input.now ?? new Date();
    const requested = input.workroomCapsuleId.trim();
    const room = await loadWorkroom(db, requested);
    const candidate: IntakeControllerCommission = {
      workroomCapsuleId: room?.capsuleId ?? requested,
      repositoryFullName: room?.repositoryFullName ?? "",
      workShape: INTAKE_CONTROLLER_WORK_SHAPE,
      commissionedByPrincipalId: input.principalRecordId,
      commissionedAt: now.toISOString(),
    };
    const verdict = evaluateIntakeControllerAuthority(
      await loadFacts(db, candidate, input.loadEnvironment ?? environmentLoader(db)),
    );
    if (!verdict.ok) return verdict;

    const commission = { ...candidate, repositoryFullName: fullName(verdict.repo) };
    const entry = ECOSYSTEM_JOB_CATALOG_ENTRIES.find((job) => job.jobId === INTAKE_CONTROLLER_JOB_ID)!;
    const existing = await db.scheduledJob.findUnique({
      where: { jobId: INTAKE_CONTROLLER_JOB_ID },
      select: { metadata: true },
    });
    const metadata = mergeIntakeControllerCommission(existing?.metadata, commission);
    await db.scheduledJob.upsert({
      where: { jobId: INTAKE_CONTROLLER_JOB_ID },
      create: { jobId: INTAKE_CONTROLLER_JOB_ID, name: entry.name, schedule: entry.cron!, metadata },
      update: { metadata },
    });
    return { ok: true, commission };
  } catch (error) {
    return { ok: false, reason: `not commissioned: ${getErrorMessage(error)}` };
  }
}
