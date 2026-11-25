import type { Prisma } from "@dpf/db";
import { z } from "zod";
import { prepareS5ControlCredential, revokeS5ControlCredential, type S5AuthenticatedControl } from "@/lib/auth/s5-room-credential.server";
import { commandPayloadBinding, runReceiptedCommand, type ReceiptDb } from "@/lib/work-capsules/command-receipts";
import type { S5AdmissionCeiling, S5AttemptLocator } from "./s5-admission.server";

const ref = z.string().min(1).max(256).regex(/^\S+$/u);
const command = z.strictObject({ workroomId: ref, sessionRef: ref, stageAttemptRef: ref, roomRowId: ref, commandId: ref });
const receiver = z.strictObject({ issuer: ref, audience: ref, hostRef: ref, resource: ref });
const mint = command.extend({ receiver });
const REHEARSAL_WINDOW_MS = 120_000;
const release = command.extend({ reason: z.enum(["attempt-released", "launch-failed", "executor-replaced", "workroom-closed"]) });

type Mint = z.infer<typeof mint>;
type Release = z.infer<typeof release>;
type CredentialCommand = { kind: "issue"; input: Mint } | { kind: "release"; input: Release };

type OwnerAttempt = S5AttemptLocator & {
  roomRowId: string;
  userId: string;
  permitExpiresAt: Date;
  status: "active" | "released";
  tokenId: string | null;
  /** Optional owner-persisted profile, never an issuance request field. */
  executionProfile?: "synthetic-rehearsal";
};

type TokenStore = {
  create: (args: { data: Prisma.McpApiTokenUncheckedCreateInput; select: { id: true } }) => Promise<{ id: string }>;
  updateMany: (args: Prisma.McpApiTokenUpdateManyArgs) => Promise<{ count: number }>;
};

export type S5CredentialLifecyclePorts = {
  db: ReceiptDb;
  getTokenStore: (tx: ReceiptDb) => TokenStore;
  /** Take the independent owners' locks first, or verify which durable write
   * predicates will fence them. Missing source, lock or predicate means hold. */
  lockOwners: (tx: ReceiptDb, command: CredentialCommand) => Promise<boolean>;
  /** Verify the authenticated command owner/receiver under the exact room lock
   * before receipt lookup, even for observation after authority was narrowed. */
  checkAccess: (tx: ReceiptDb, command: CredentialCommand) => Promise<boolean>;
  /** Existing attempt owner's persisted pin and fence, never reconstructed from a launch. */
  readAttempt: (tx: ReceiptDb, locator: S5AttemptLocator) => Promise<OwnerAttempt | null>;
  composeAdmission: (tx: ReceiptDb, locator: S5AttemptLocator) => Promise<S5AdmissionCeiling | null>;
  /** Compare-and-write token and original deadline to the existing attempt
   * owner under the same transaction. Do not derive either on a broker call. */
  pinToken: (tx: ReceiptDb, attempt: OwnerAttempt, tokenId: string, expiresAt: number) => Promise<boolean>;
  closeAttempt: (tx: ReceiptDb, attempt: OwnerAttempt) => Promise<boolean>;
  now?: () => Date;
};

type Held = { kind: "held" };
type IssueResult = Held | { kind: "issued"; tokenId: string; plaintext: string; expiresAt: number };
type ReleaseResult = Held | { kind: "released" };
const held: Held = { kind: "held" };
class CredentialHeld extends Error {}

function locatorOf({ workroomId, sessionRef, stageAttemptRef }: S5AttemptLocator): S5AttemptLocator {
  return { workroomId, sessionRef, stageAttemptRef };
}

function sameAttempt(a: S5AttemptLocator, b: S5AttemptLocator): boolean {
  return a.workroomId === b.workroomId && a.sessionRef === b.sessionRef && a.stageAttemptRef === b.stageAttemptRef;
}

/** Internal transaction only. The caller is the protected runtime owner and
 * all injected ports use this transaction, with no network I/O under its locks.
 * This doesn't register a transport, launch a provider, or mint on replay. */
export function createS5CredentialLifecycle(ports: S5CredentialLifecyclePorts) {
  const now = ports.now ?? (() => new Date());

  function commandIdentity(request: CredentialCommand) {
    const { input, kind } = request;
    return {
      db: ports.db,
      authorityScopeKey: `s5-credential:${input.workroomId}`,
      commandId: input.commandId,
      commandType: `s5-credential.${kind}`,
      target: { kind: "workroom", id: input.workroomId },
      expectedRoomRowId: input.roomRowId,
      payloadBinding: commandPayloadBinding({ version: 1, kind, input }),
      beforeRoomLock: async (tx: ReceiptDb) => {
        if (await ports.lockOwners(tx, request) !== true) throw new CredentialHeld();
      },
      beforeReceiptRead: (tx: ReceiptDb) => ports.checkAccess(tx, request),
    };
  }

  async function currentAttempt(tx: ReceiptDb, input: Mint | Release): Promise<OwnerAttempt> {
    const attempt = await ports.readAttempt(tx, locatorOf(input));
    if (!attempt || attempt.roomRowId !== input.roomRowId || !sameAttempt(attempt, input)
      || (attempt.status !== "active" && attempt.status !== "released")
      || (attempt.tokenId !== null && !ref.safeParse(attempt.tokenId).success)) throw new CredentialHeld();
    return attempt;
  }

  /** A held answer conveys no authority. When commit is uncertain, retrying
   * this command cannot recover the bearer. Resolve/release the original pin
   * before any new separately admitted attempt. */
  async function issue(input: z.infer<typeof command> & { receiver: S5AuthenticatedControl }): Promise<IssueResult> {
    const parsed = mint.safeParse(input);
    if (!parsed.success) return held;
    const value = parsed.data;
    const pending: { delivery?: Extract<IssueResult, { kind: "issued" }> } = {};
    try {
      const committed = await runReceiptedCommand<{ kind: "issued"; tokenId: string; expiresAt: number }>({
        ...commandIdentity({ kind: "issue", input: value }),
        run: async (tx) => {
          const attempt = await currentAttempt(tx, value);
          if (attempt.status !== "active" || attempt.tokenId !== null) throw new CredentialHeld();
          const admission = await ports.composeAdmission(tx, locatorOf(value));
          if (!admission || !sameAttempt(admission.locator, value)) throw new CredentialHeld();
          const issuedAt = now();
          if (attempt.executionProfile !== undefined && attempt.executionProfile !== "synthetic-rehearsal") throw new CredentialHeld();
          const expiry = attempt.executionProfile === "synthetic-rehearsal"
            ? new Date(Math.min(attempt.permitExpiresAt.getTime(), issuedAt.getTime() + REHEARSAL_WINDOW_MS))
            : attempt.permitExpiresAt;
          const prepared = prepareS5ControlCredential({ admission, receiver: value.receiver,
            userId: attempt.userId, now: issuedAt, expiresAt: expiry });
          if (!prepared) throw new CredentialHeld();
          const expiresAt = prepared.data.expiresAt.getTime();
          const token = await ports.getTokenStore(tx).create({ data: prepared.data, select: { id: true } });
          if (!ref.safeParse(token?.id).success || await ports.pinToken(tx, attempt, token.id, expiresAt) !== true) throw new CredentialHeld();
          pending.delivery = { kind: "issued", tokenId: token.id, plaintext: prepared.plaintext, expiresAt };
          return { kind: "issued", tokenId: token.id, expiresAt };
        },
      });
      if (committed?.kind !== "issued" || pending.delivery?.tokenId !== committed.tokenId) return held;
      return pending.delivery;
    } catch {
      return held;
    }
  }

  async function releaseAttempt(input: Release): Promise<ReleaseResult> {
    const parsed = release.safeParse(input);
    if (!parsed.success) return held;
    const value = parsed.data;
    try {
      const result = await runReceiptedCommand<{ kind: "released" }>({
        ...commandIdentity({ kind: "release", input: value }),
        run: async (tx) => {
          const attempt = await currentAttempt(tx, value);
          if (attempt.status === "active" && await ports.closeAttempt(tx, attempt) !== true) throw new CredentialHeld();
          // Repeat the exact idempotent revoke on an independently authorized
          // release of the same already-fenced attempt. Never read a successor.
          if (attempt.tokenId !== null) await revokeS5ControlCredential({ mcpApiToken: ports.getTokenStore(tx) }, {
            ...locatorOf(value), tokenId: attempt.tokenId, reason: value.reason, now: now(),
          });
          return { kind: "released" };
        },
      });
      return result?.kind === "released" ? { kind: "released" } : held;
    } catch {
      return held;
    }
  }

  return { issue, release: releaseAttempt };
}
