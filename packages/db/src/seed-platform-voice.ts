// Ship the founder's recorded seed voice (BI-2535D6F4).
//
// This bundles the real founder recording from packages/db/data/seed-voices/...
// and, on install / seed, creates the consent record + a ready VoiceProfile for
// the mark-dpf-platform DecisionPerspectiveProfile (the "voice profile in the
// build"). The clip is copied into the final runtime uploads root
// (UPLOAD_STORAGE_PATH or equivalent) so the TTS sidecar (especially the
// Apple-Silicon host sidecar on Mac) can use it for zero-shot cloning out of
// the box. The Mac installer TTS setup script also forces the copy into the
// host-visible DPF_TTS_REFERENCE_HOST_ROOT to guarantee the file is present
// even if seed timing / placeholder files from prior runs would have skipped it.
//
// Chatterbox is zero-shot: the reference clip IS the voice clone (no training).
// Idempotent — safe to re-run on every seed.

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
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

/** Copy the bundled clip into the storage root if absent (or if the existing
 *  file is a tiny placeholder). Returns whether it copied. Best-effort.
 *  This is what guarantees the "voice profile in the build" (the real founder
 *  recording for mark-dpf-platform) is present for the seeded VoiceProfile. */
function defaultCopyClip(): boolean {
  const dest = storageDestPath();
  const src = bundledClipPath();
  if (!existsSync(src)) return false;

  const srcSz = ((): number => {
    try { return statSync(src).size; } catch { return 0; }
  })();
  const needCopy = !existsSync(dest) || (() => {
    try {
      const dstSz = statSync(dest).size;
      return dstSz < 20000 && srcSz > 20000; // placeholder vs real recording
    } catch { return true; }
  })();

  if (!needCopy) return false;

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
