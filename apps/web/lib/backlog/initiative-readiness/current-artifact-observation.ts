import { canonicalJson } from "@dpf/integration-shared/canonical-json";

export type ArtifactObservationDb = {
  $queryRaw?: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};
export type ArtifactObservationBinding =
  | { kind: "bound"; itemRowId: string; room: { capsuleId: string } }
  | { kind: "not-applicable" | "unavailable" };

/** Receipt writers serialize on the subject; room source changes must wait too. */
export async function lockCurrentArtifactBinding(
  binding: Extract<ArtifactObservationBinding, { kind: "bound" }>, db: ArtifactObservationDb,
) {
  if (!db.$queryRaw) throw new Error("Current artifact admission requires source locks");
  await db.$queryRaw`SELECT "id" FROM "BacklogItem" WHERE "id" = ${binding.itemRowId} FOR UPDATE`;
  await db.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "capsuleId" = ${binding.room.capsuleId} FOR SHARE`;
}

/** One provider read outside admission, then the same binding checked under locks. */
export async function prepareCurrentArtifactObservation<B extends ArtifactObservationBinding, E>(args: {
  db: ArtifactObservationDb;
  load: (db: ArtifactObservationDb) => Promise<B>;
  read: (binding: Extract<B, { kind: "bound" }>) => Promise<E>;
  unbound: (binding: Exclude<B, { kind: "bound" }>) => E;
  unavailable: E;
  isUnavailable: (evidence: E) => boolean;
  lock?: (binding: Extract<B, { kind: "bound" }>, db: ArtifactObservationDb) => Promise<void>;
}): Promise<{ evidence: E; admissionGuard: (db: ArtifactObservationDb) => Promise<E> }> {
  let initial: B | undefined;
  let fingerprint: string | undefined;
  let evidence = args.unavailable;
  try {
    initial = await args.load(args.db);
    fingerprint = canonicalJson(initial);
    evidence = initial.kind === "bound"
      ? await args.read(initial as Extract<B, { kind: "bound" }>)
      : args.unbound(initial as Exclude<B, { kind: "bound" }>);
    if (canonicalJson(await args.load(args.db)) !== fingerprint) evidence = args.unavailable;
  } catch { evidence = args.unavailable; }
  return { evidence, admissionGuard: async db => {
    if (!initial || args.isUnavailable(evidence)) return args.unavailable;
    try {
      if (initial.kind === "bound") {
        const binding = initial as Extract<B, { kind: "bound" }>;
        await (args.lock ?? lockCurrentArtifactBinding)(binding, db);
      }
      return canonicalJson(await args.load(db)) === fingerprint ? evidence : args.unavailable;
    } catch { return args.unavailable; }
  } };
}
