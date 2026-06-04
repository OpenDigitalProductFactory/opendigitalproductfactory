// Ship the founder's recorded seed voice (BI-2535D6F4).
//
// The mark-dpf-platform reference clip the founder recorded lives only in this
// install's gitignored uploads dir, so a fresh install gets no default voice.
// This bundles the clip (packages/db/data/seed-voices/...) and seeds it on
// install: a founder consent record + a ready chatterbox VoiceProfile on the
// mark-dpf-platform DecisionPerspectiveProfile, and copies the clip into the
// runtime voice storage root so synthesis can use it immediately.
//
// Chatterbox is zero-shot: the reference clip IS the voice clone (no training).
// Idempotent — safe to re-run on every seed.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PrismaClient } from "../generated/client/client";

export const PLATFORM_VOICE_PROFILE_ID = "mark-dpf-platform";
const VOICE_REL_PATH = "voices/mark-dpf-platform/reference.webm";

/** The Prisma delegates this seed touches. Pick from PrismaClient so the real
 *  client is assignable; tests pass a fake cast to this type. */
export type SeedPlatformVoiceClient = Pick<
  PrismaClient,
  "decisionPerspectiveProfile" | "voiceProfile" | "voiceConsentRecord" | "principal"
>;

export type SeedPlatformVoiceResult = {
  status: "seeded" | "skipped-no-platform-profile";
  voiceProfileId?: string;
  consentRecordId?: string;
  copiedClip: boolean;
};

function bundledClipPath(): string {
  return join(__dirname, "..", "data", "seed-voices", "mark-dpf-platform", "reference.webm");
}

/** Runtime voice storage root. Mirrors resolveVoiceStorageRoot's primary path
 *  (UPLOAD_STORAGE_PATH, else <repoRoot>/data/uploads) without importing from
 *  apps/web — the seed runs in packages/db. */
function storageDestPath(): string {
  const root =
    process.env.UPLOAD_STORAGE_PATH ?? join(__dirname, "..", "..", "..", "data", "uploads");
  return join(root, "voices", "mark-dpf-platform", "reference.webm");
}

/** Copy the bundled clip into the storage root if absent. Returns whether it
 *  copied. Best-effort: a copy failure must not fail the seed. */
function defaultCopyClip(): boolean {
  const dest = storageDestPath();
  const src = bundledClipPath();
  if (existsSync(dest) || !existsSync(src)) return false;
  try {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
}

export async function seedPlatformVoice(
  db: SeedPlatformVoiceClient,
  deps: { copyClip?: () => boolean } = {},
): Promise<SeedPlatformVoiceResult> {
  const copyClip = deps.copyClip ?? defaultCopyClip;

  const profile = (await db.decisionPerspectiveProfile.findUnique({
    where: { profileId: PLATFORM_VOICE_PROFILE_ID },
    select: { id: true },
  })) as { id: string } | null;
  if (!profile) return { status: "skipped-no-platform-profile", copiedClip: false };

  const existing = (await db.voiceProfile.findUnique({
    where: { profileId: PLATFORM_VOICE_PROFILE_ID },
    select: { consentRecordId: true },
  })) as { consentRecordId: string | null } | null;

  // Founder principal for consent attribution (capturedByPrincipalId has no FK).
  const principal = (await db.principal.findFirst({
    where: { kind: "human" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })) as { id: string } | null;
  const capturedByPrincipalId = principal?.id ?? "seed";

  // Reuse an existing consent link; otherwise capture one (founder self-recorded).
  let consentRecordId = existing?.consentRecordId ?? null;
  if (!consentRecordId) {
    const consent = (await db.voiceConsentRecord.create({
      data: {
        subjectName: "Mark Bodman",
        consentMethod: "recorded-statement",
        authorizedUseCases: ["platform-coworker-voice"],
        authorizedLanguages: ["en"],
        authorizedTerritories: ["global"],
        expiresAt: new Date("2099-12-31T00:00:00.000Z"),
        capturedByPrincipalId,
        evidenceRef: "seed:mark-dpf-platform-voice",
      },
      select: { id: true },
    })) as { id: string };
    consentRecordId = consent.id;
  }

  const voiceData = {
    provider: "chatterbox",
    providerVoiceId: VOICE_REL_PATH,
    status: "ready",
    sampleCount: 1,
    consentType: "explicit-recorded",
    consentRecordId,
    language: "en",
  };
  await db.voiceProfile.upsert({
    where: { profileId: PLATFORM_VOICE_PROFILE_ID },
    update: voiceData,
    create: { profileId: PLATFORM_VOICE_PROFILE_ID, ...voiceData },
  });

  await db.decisionPerspectiveProfile.update({
    where: { profileId: PLATFORM_VOICE_PROFILE_ID },
    data: { voiceEnabled: true },
  });

  const copiedClip = copyClip();
  return { status: "seeded", voiceProfileId: PLATFORM_VOICE_PROFILE_ID, consentRecordId, copiedClip };
}
