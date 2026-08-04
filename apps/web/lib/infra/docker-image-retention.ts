// Age-based retention for tagged per-branch Docker images (BI-A53DFC81).
//
// WHY THIS IS SEPARATE FROM scripts/lib/local-integration-image-retention.mjs:
// that module reaps a slot's SUPERSEDED images and runs host-side from
// local-ci-bounded-build.mjs immediately after a green build. It is the right
// mechanism for the case it covers, and this does not replace it.
//
// What it cannot cover is the long tail. It only reaps a slot when that slot
// BUILDS AGAIN, so a branch that built a few times and then merged keeps its
// ~5GB image forever — nothing ever supersedes it. That tail is unbounded in
// branches-ever-verified rather than in active slots.
//
// And `docker image prune` does not catch them either: it removes only DANGLING
// images, and every one of these is TAGGED. So the weekly sweep could run
// perfectly, every week, forever, and never touch the category that filled the
// Docker data disk to zero on 2026-07-31, took the ext4 filesystem read-only,
// and killed Postgres with SIGBUS. Measured 2026-08-04: 0 dangling images
// alongside 105 tagged ones at ~5GB each.

export type DockerImageRow = {
  /** Repository without the tag, e.g. `dpf-local-integration-slot-0-foo-build`. */
  repository: string;
  /** Full `repository:tag` reference used for removal. */
  tag: string;
  /** Creation time in epoch ms. */
  createdAt: number;
};

export type StaleImagePlanInput = {
  images: readonly DockerImageRow[];
  /** Image references held by ANY container, running or stopped. */
  inUse?: readonly string[];
  now?: number;
  maxAgeMs?: number;
};

/** Default retention window. A week is long enough that an active branch keeps
 *  its warm image across a normal working pause, short enough that the tail
 *  cannot reach the volumes that caused the outage. */
export const DEFAULT_IMAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Namespaces this sweep owns. Everything else is left strictly alone — a
 *  blanket age sweep here would happily delete postgres, grafana, or the portal
 *  image itself, so the allowlist is the load-bearing safety property. */
const MANAGED_PATTERNS: readonly RegExp[] = [
  /^dpf-local-integration-/,
  /-local-ci-portal$/,
];

export function isManagedImage(repository: string): boolean {
  return MANAGED_PATTERNS.some((pattern) => pattern.test(repository));
}

/**
 * Group key for "keep the newest of these".
 *
 * A slot-scoped repository groups by its slot, so each slot retains a warm
 * image. Anything else is its own group, which means a one-off portal image is
 * never reaped by age alone — only once a newer one supersedes it.
 */
export function imageGroupKey(repository: string): string {
  const slot = /^(dpf-local-integration-slot-\d+)-/.exec(repository);
  return slot ? slot[1] : repository;
}

/**
 * Which managed images are stale enough to reap. Pure — docker stays in the caller.
 *
 * Three guards, all of which must pass:
 *  1. the image is in a namespace this sweep owns
 *  2. it is referenced by no container, running or stopped
 *  3. it is not the newest in its group AND it is older than `maxAgeMs`
 *
 * Guard 3 keeps the newest per group even when that image is ancient: reaping a
 * live slot's only image forces a cold rebuild on its next run, which is the
 * cost this retention exists to stop paying repeatedly.
 */
export function planStaleImageReaping(input: StaleImagePlanInput): string[] {
  const now = input.now ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_IMAGE_MAX_AGE_MS;
  const referenced = new Set(input.inUse ?? []);

  const managed = (input.images ?? []).filter(
    (image): image is DockerImageRow =>
      Boolean(image) &&
      typeof image.repository === "string" &&
      typeof image.tag === "string" &&
      isManagedImage(image.repository) &&
      !referenced.has(image.repository) &&
      !referenced.has(image.tag),
  );

  const newestPerGroup = new Map<string, DockerImageRow>();
  for (const image of managed) {
    const key = imageGroupKey(image.repository);
    const current = newestPerGroup.get(key);
    if (!current || image.createdAt > current.createdAt) newestPerGroup.set(key, image);
  }

  return managed
    .filter((image) => {
      if (newestPerGroup.get(imageGroupKey(image.repository)) === image) return false;
      return now - image.createdAt > maxAgeMs;
    })
    .map((image) => image.tag);
}

/** Parse `docker images --format '{{.Repository}}||{{.Repository}}:{{.Tag}}||{{.CreatedAt}}'`.
 *  Rows with an unparseable date are dropped rather than treated as epoch 0,
 *  which would make them look infinitely old and therefore reapable. */
export function parseDockerImageRows(stdout: string): DockerImageRow[] {
  return (stdout ?? "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [repository, tag, created] = line.split("||");
      return { repository, tag, createdAt: new Date(created).getTime() };
    })
    .filter(
      (row) =>
        Boolean(row.repository) && Boolean(row.tag) && Number.isFinite(row.createdAt),
    );
}
