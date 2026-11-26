import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { prisma } from "@dpf/db";
import type { RecordLifecycle } from "@dpf/db";

import { decideExecutionHostRegistration, executionHostIdentity, executionHostRef, readExecutionHostObservation,
  type ExecutionHostIdentity, type ExecutionHostRoute } from "./execution-host-registry";

export type HostObservationInput = {
  localInstallationRef: string;
  authenticated: ExecutionHostIdentity & { source: "local-host-agent" | "paired-install" };
  report: unknown;
};

type EndpointFields = { loopbackEndpointRef: string | null; tailnetEndpointRef: string | null; httpsEndpointRef: string | null };
type ObservationFields = EndpointFields & { lastObservedAt: Date };
type HostRow = ExecutionHostIdentity & ObservationFields & { id: string; lifecycle: RecordLifecycle };
type HostKey = Pick<ExecutionHostIdentity, "installationRef" | "hostRef">;
type HostStore = { executionHost: {
  findUnique(args: { where: { installationRef_hostRef: HostKey } }): Promise<HostRow | null>;
  createMany(args: { data: ExecutionHostIdentity & ObservationFields & { registeredAt: Date }; skipDuplicates: true }): Promise<{ count: number }>;
  updateMany(args: { where: ExecutionHostIdentity & { id: string; lifecycle: "active"; lastObservedAt: { lte: Date } }; data: ObservationFields }): Promise<{ count: number }>;
} };
type RegistryDb = HostStore & { $transaction<T>(run: (tx: HostStore) => Promise<T>, options: { isolationLevel: "ReadCommitted" }): Promise<T> };

type ObservationResult = ActionResult<{ registrationRef: string }>;

function where({ installationRef, hostRef }: HostKey) { return { installationRef_hostRef: { installationRef, hostRef } }; }

/** Server-only registry. Its caller owns local host-agent authentication and install resolution. */
export function createExecutionHostRegistry(deps: { db?: RegistryDb; now?: () => Date } = {}) {
  const db: RegistryDb = deps.db ?? prisma;
  const now = deps.now ?? (() => new Date());
  return {
    async observe(input: HostObservationInput): Promise<ObservationResult> {
      const observedAt = now();
      const parsed = decideExecutionHostRegistration({ ...input, existing: null, observedAt });
      if (!parsed.ok) return parsed;
      const { identity, routes } = parsed.data;
      const endpoint = (kind: ExecutionHostRoute["kind"]) => routes.find((route) => route.kind === kind)?.endpointRef ?? null;
      const observation: ObservationFields = { loopbackEndpointRef: endpoint("loopback"), tailnetEndpointRef: endpoint("tailnet"),
        httpsEndpointRef: endpoint("https"), lastObservedAt: observedAt };
      return db.$transaction(async (tx) => {
        const key = where(identity);
        let existing = await tx.executionHost.findUnique({ where: key });
        if (!existing) {
          const inserted = await tx.executionHost.createMany({ data: { ...identity, ...observation, registeredAt: observedAt }, skipDuplicates: true });
          existing = await tx.executionHost.findUnique({ where: key });
          if (!existing) return err("registration-unavailable");
          if (inserted.count === 1) return ok({ registrationRef: existing.id });
        }
        const decision = decideExecutionHostRegistration({ ...input, existing, observedAt });
        if (!decision.ok) return decision;
        if (existing.lifecycle !== "active") return err("registration-retired");
        // Never write identity columns. A stale observation or concurrent retirement cannot replace routes.
        const updated = await tx.executionHost.updateMany({ where: { ...identity, id: existing.id,
          lifecycle: "active", lastObservedAt: { lte: observedAt } }, data: observation });
        return updated.count === 1 ? ok({ registrationRef: existing.id }) : err("observation-no-longer-current");
      }, { isolationLevel: "ReadCommitted" });
    },
    async findCandidate(identity: HostKey) {
      if (!executionHostRef.safeParse(identity.installationRef).success || !executionHostRef.safeParse(identity.hostRef).success) return null;
      const row = await db.executionHost.findUnique({ where: where(identity) });
      if (!row || row.lifecycle !== "active" || row.installationRef !== identity.installationRef || row.hostRef !== identity.hostRef) return null;
      const binding = executionHostIdentity.safeParse({ installationRef: row.installationRef, hostRef: row.hostRef, receiverRef: row.receiverRef });
      const routes = readExecutionHostObservation([
        { kind: "loopback", endpointRef: row.loopbackEndpointRef }, { kind: "tailnet", endpointRef: row.tailnetEndpointRef },
        { kind: "https", endpointRef: row.httpsEndpointRef },
      ].filter((route) => route.endpointRef !== null));
      return binding.success && executionHostRef.safeParse(row.id).success && routes ? { ...binding.data, registrationRef: row.id, routes } : null;
    },
  };
}
