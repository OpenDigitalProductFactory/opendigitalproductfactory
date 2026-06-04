import { describe, expect, it, vi } from "vitest";

import {
  seedPlatformVoice,
  PLATFORM_VOICE_PROFILE_ID,
  type SeedPlatformVoiceClient,
} from "./seed-platform-voice";

type Row = Record<string, any>;
function makeDb(opts: {
  hasProfile?: boolean;
  existingVoiceConsentId?: string | null;
  principalId?: string | null;
} = {}) {
  const hasProfile = opts.hasProfile ?? true;
  const consents: Row[] = [];
  const voiceUpserts: Row[] = [];
  const profileUpdates: Row[] = [];
  let consentSeq = 0;

  const db = {
    decisionPerspectiveProfile: {
      findUnique: vi.fn(async () => (hasProfile ? { id: "dpp_1" } : null)),
      update: vi.fn(async (args: any) => {
        profileUpdates.push(args.data);
        return args.data;
      }),
    },
    voiceProfile: {
      findUnique: vi.fn(async () =>
        opts.existingVoiceConsentId === undefined
          ? null
          : { consentRecordId: opts.existingVoiceConsentId },
      ),
      upsert: vi.fn(async (args: any) => {
        voiceUpserts.push(args);
        return args.create;
      }),
    },
    voiceConsentRecord: {
      create: vi.fn(async (args: any) => {
        const row = { id: `vc_${++consentSeq}`, ...args.data };
        consents.push(row);
        return { id: row.id };
      }),
    },
    principal: {
      findFirst: vi.fn(async () =>
        opts.principalId === null ? null : { id: opts.principalId ?? "prn_founder" },
      ),
    },
  } as unknown as SeedPlatformVoiceClient;
  return { db, consents, voiceUpserts, profileUpdates };
}

describe("seedPlatformVoice", () => {
  it("seeds a founder consent + a ready chatterbox voice + enables voice + copies the clip", async () => {
    const fake = makeDb();
    const copyClip = vi.fn(() => true);
    const res = await seedPlatformVoice(fake.db, { copyClip });

    expect(res.status).toBe("seeded");
    expect(res.voiceProfileId).toBe(PLATFORM_VOICE_PROFILE_ID);
    expect(res.copiedClip).toBe(true);

    // consent: founder self-recorded, attributed to the founder principal
    expect(fake.consents).toHaveLength(1);
    expect(fake.consents[0]).toMatchObject({
      subjectName: "Mark Bodman",
      consentMethod: "recorded-statement",
      capturedByPrincipalId: "prn_founder",
    });

    // voice profile: ready chatterbox pointing at the reference clip
    const upsert = fake.voiceUpserts[0];
    expect(upsert.where).toMatchObject({ profileId: PLATFORM_VOICE_PROFILE_ID });
    expect(upsert.create).toMatchObject({
      provider: "chatterbox",
      providerVoiceId: "voices/mark-dpf-platform/reference.webm",
      status: "ready",
      consentType: "explicit-recorded",
    });

    // voice enabled on the perspective profile
    expect(fake.profileUpdates[0]).toMatchObject({ voiceEnabled: true });
  });

  it("is idempotent — reuses an existing consent link, creates no new consent", async () => {
    const fake = makeDb({ existingVoiceConsentId: "vc_existing" });
    const res = await seedPlatformVoice(fake.db, { copyClip: () => false });

    expect(res.status).toBe("seeded");
    expect(res.consentRecordId).toBe("vc_existing");
    expect(fake.consents).toHaveLength(0); // no new consent
    expect(fake.voiceUpserts).toHaveLength(1); // still re-asserts the voice profile
  });

  it("skips when the mark-dpf-platform profile is absent", async () => {
    const fake = makeDb({ hasProfile: false });
    const copyClip = vi.fn(() => true);
    const res = await seedPlatformVoice(fake.db, { copyClip });

    expect(res.status).toBe("skipped-no-platform-profile");
    expect(fake.voiceUpserts).toHaveLength(0);
    expect(fake.consents).toHaveLength(0);
    expect(copyClip).not.toHaveBeenCalled();
  });
});
