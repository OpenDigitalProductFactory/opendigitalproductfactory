// Semantic review routing sensitivity comes from the reviewed Workroom
// (BI-9F620FE1, DI-AF686F829ADE).
//
// Founder direction, 2026-11-05: "The workroom dictates the type of work." and
// "Dev work is 100% public." The room's own sensitivity is already resolved
// by resolveRoomSensitivityCeiling: a declared boundary ceiling, otherwise the
// backlog item's effective sensitivity, where platform work reads public
// (DI-5E19848444FC), otherwise the fail-closed `internal`.
//
// A public room is trusted public-source provenance only when the room's own
// repository is public on GitHub: scanning code cannot establish visibility
// (#6196), and a platform room on a private fork is not public source. Then
// the review routes as "development" (code clearance), exactly as Build
// Studio's code turns do. Any other ceiling passes through; anything unproven
// is `internal`. Payload screening still runs on every review, so a secret,
// personal record or financial identifier inside a platform diff is still
// classified and kept local.

import type { RepositoryVisibility } from "@/lib/forge/managed-repository-access";
import type { SourceCodeProvenance } from "@/lib/inference/data-screening/types";

export type SemanticReviewRouteSensitivity = "development" | "internal" | "confidential" | "restricted";

/** Map a room's sensitivity ceiling and repository visibility to the sensitivity a review declares. */
export function semanticReviewRouteSensitivity(
  roomCeiling: string | null | undefined,
  repositoryVisibility: RepositoryVisibility,
): SemanticReviewRouteSensitivity {
  switch (roomCeiling) {
    case "public": return repositoryVisibility === "public" ? "development" : "internal";
    case "confidential":
    case "restricted": return roomCeiling;
    default: return "internal";
  }
}

type RoomRow = { scopeClaims: unknown; backlogItemId: string | null; repositoryFullName: string | null };
export type SemanticReviewRoomDeps = {
  readRoom?: (capsuleId: string) => Promise<RoomRow | null>;
  ceiling?: (room: RoomRow) => Promise<string>;
  visibility?: (repositoryFullName: string | null) => Promise<RepositoryVisibility>;
};

/**
 * How a review routes: the sensitivity it declares, plus the reviewed room's
 * repository record when one was read (BI-FC94F754). The payload screen uses
 * that record to classify the diff by its repository instead of treating any
 * code as confidential.
 */
export type SemanticReviewRoute = {
  sensitivity: SemanticReviewRouteSensitivity;
  sourceCodeProvenance?: SourceCodeProvenance;
};

/** The reviewed room's route; anything unreadable is `internal` with no provenance. */
export async function resolveSemanticReviewRoute(
  capsuleId: string | undefined,
  deps: SemanticReviewRoomDeps = {},
): Promise<SemanticReviewRoute> {
  if (!capsuleId) return { sensitivity: "internal" };
  try {
    const room = await (deps.readRoom ?? readRoom)(capsuleId);
    if (!room) return { sensitivity: "internal" };
    const ceiling = await (deps.ceiling ?? roomCeiling)(room);
    // Visibility is asked only for a public room; it never lowers any other ceiling.
    if (ceiling !== "public") return { sensitivity: semanticReviewRouteSensitivity(ceiling, "unknown") };
    // A room that names no repository has no visibility to prove.
    const repository = room.repositoryFullName?.trim();
    if (!repository) return { sensitivity: semanticReviewRouteSensitivity(ceiling, "unknown") };
    const visibility = await (deps.visibility ?? repositoryVisibility)(repository);
    return {
      sensitivity: semanticReviewRouteSensitivity(ceiling, visibility),
      sourceCodeProvenance: { repository, visibility },
    };
  } catch {
    return { sensitivity: "internal" };
  }
}

/** The reviewed room's routing sensitivity; anything unreadable is `internal`. */
export async function resolveSemanticReviewRoomSensitivity(
  capsuleId: string | undefined,
  deps: SemanticReviewRoomDeps = {},
): Promise<SemanticReviewRouteSensitivity> {
  return (await resolveSemanticReviewRoute(capsuleId, deps)).sensitivity;
}

/** A public answer is reused this long; anything else is asked again next time. */
export const REPOSITORY_VISIBILITY_TTL_MS = 5 * 60 * 1000;
const publicRepositories = new Map<string, number>();

export function resetSemanticReviewVisibilityCache(): void {
  publicRepositories.clear();
}

export async function repositoryVisibility(
  repositoryFullName: string | null,
  read?: (repo: { owner: string; repo: string }) => Promise<RepositoryVisibility>,
  now: () => number = Date.now,
): Promise<RepositoryVisibility> {
  const { parseManagedRepositoryInput, readRepositoryVisibility } = await import("@/lib/forge/managed-repository-access");
  const repository = parseManagedRepositoryInput(repositoryFullName);
  if (!repository) return "unknown";
  const cachedAt = publicRepositories.get(repository.fullName);
  if (cachedAt !== undefined && now() - cachedAt < REPOSITORY_VISIBILITY_TTL_MS) return "public";
  const visibility = await (read ?? readRepositoryVisibility)(repository);
  // Only a public answer is cached: a failed or rate-limited read is never trusted.
  if (visibility === "public") publicRepositories.set(repository.fullName, now());
  else publicRepositories.delete(repository.fullName);
  return visibility;
}

// Imported lazily so importing the dispatcher does not construct the database client.
async function readRoom(capsuleId: string): Promise<RoomRow | null> {
  const { prisma } = await import("@dpf/db");
  return prisma.workroom.findUnique({ where: { capsuleId }, select: { scopeClaims: true, backlogItemId: true, repositoryFullName: true } });
}

async function roomCeiling(room: RoomRow): Promise<string> {
  const { resolveRoomSensitivityCeiling } = await import("@/lib/work-management/room-sensitivity-ceiling.server");
  return resolveRoomSensitivityCeiling(room);
}
