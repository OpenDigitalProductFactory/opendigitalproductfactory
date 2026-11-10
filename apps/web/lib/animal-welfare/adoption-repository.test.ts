import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    animalProfile: { findFirst: vi.fn(), update: vi.fn() },
    animalAdoptionApplication: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    animalPlacement: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    animalCustodyEpisode: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    animalCustodyEvent: { create: vi.fn() },
    adoptableAnimal: { updateMany: vi.fn(), findFirst: vi.fn() },
    resourceCapacityAllocation: { updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    resource: { findFirst: vi.fn() },
    storefrontDonation: { create: vi.fn() },
    workEngagement: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    workEngagementActivity: { aggregate: vi.fn(), create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  },
}));

import { prisma } from "@dpf/db";
import {
  AdoptionCommandError,
  cancelAdoptionReservation,
  completeAdoptionPlacement,
  createAdoptionApplication,
  returnAdoptedAnimal,
  transitionAdoptionApplicationCommand,
  validateScreening,
} from "./adoption-repository";

const ORG = "org-1";
const ACTOR = { userId: "user-1", principalRef: "principal-1" };
const NOW = new Date("2026-09-18T10:00:00Z");
const SCREENING = { housing: "Owned house", otherPets: "None", children: "Two, 8 and 11", landlordPermission: "not-applicable", experience: "Had dogs for 20 years" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async (work: unknown) => (work as (tx: typeof prisma) => Promise<unknown>)(prisma) as never);
  vi.mocked(prisma.animalAdoptionApplication.update).mockResolvedValue({ id: "app-1" } as never);
  vi.mocked(prisma.animalPlacement.update).mockResolvedValue({ id: "pl-1" } as never);
  vi.mocked(prisma.adoptableAnimal.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.animalProfile.update).mockResolvedValue({ id: "animal-1" } as never);
  vi.mocked(prisma.animalCustodyEpisode.update).mockResolvedValue({ id: "ep-1" } as never);
  vi.mocked(prisma.animalCustodyEvent.create).mockResolvedValue({} as never);
  vi.mocked(prisma.resourceCapacityAllocation.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.workEngagement.findUnique).mockResolvedValue({ id: "visit-1" } as never);
  vi.mocked(prisma.workEngagement.update).mockResolvedValue({} as never);
  vi.mocked(prisma.workEngagementActivity.aggregate).mockResolvedValue({ _max: { seq: 0 } } as never);
  vi.mocked(prisma.workEngagementActivity.create).mockResolvedValue({ id: "act", seq: 1 } as never);
});

describe("validateScreening", () => {
  it("requires every screening answer and a landlord decision", () => {
    expect(validateScreening(SCREENING)).toEqual(SCREENING);
    expect(() => validateScreening({ ...SCREENING, housing: " " })).toThrow(AdoptionCommandError);
    expect(() => validateScreening({ ...SCREENING, landlordPermission: "maybe" })).toThrow(/landlord/);
  });
});

describe("createAdoptionApplication", () => {
  it("records a submitted application with screening for an animal in care", async () => {
    vi.mocked(prisma.animalProfile.findFirst).mockResolvedValue({ id: "animal-1", name: "Ranger" } as never);
    vi.mocked(prisma.animalAdoptionApplication.create).mockResolvedValue({ id: "app-1", applicationRef: "AA-1" } as never);
    const result = await createAdoptionApplication({ organizationId: ORG, actor: ACTOR, now: NOW, command: { animalProfileId: "animal-1", applicantName: "Dana Ortiz", screening: SCREENING } });
    expect(result).toEqual({ applicationId: "app-1", applicationRef: "AA-1" });
    expect(prisma.animalAdoptionApplication.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG, animalProfileId: "animal-1", applicantName: "Dana Ortiz", status: "submitted", screening: SCREENING }) }));
  });

  it("refuses an animal outside the organization", async () => {
    vi.mocked(prisma.animalProfile.findFirst).mockResolvedValue(null);
    await expect(createAdoptionApplication({ organizationId: ORG, actor: ACTOR, command: { animalProfileId: "x", applicantName: "Dana", screening: SCREENING } })).rejects.toMatchObject({ code: "animal_not_found" });
  });
});

describe("transitionAdoptionApplicationCommand", () => {
  function app(status: string, lifecycleStatus = "placement_ready") {
    return { id: "app-1", status, version: 2, applicantName: "Dana Ortiz", animalProfileId: "animal-1", animal: { name: "Ranger", animalRef: "AN-1", lifecycleStatus } };
  }

  it("schedules a meet-and-greet as dated work on the animal", async () => {
    vi.mocked(prisma.animalAdoptionApplication.findFirst).mockResolvedValue(app("screening") as never);
    vi.mocked(prisma.workEngagement.create).mockResolvedValue({ id: "visit-1" } as never);
    const result = await transitionAdoptionApplicationCommand({ organizationId: ORG, actor: ACTOR, now: NOW, command: { applicationId: "app-1", to: "meet-and-greet", expectedVersion: 2, visitAt: "2026-09-20T14:00:00Z" } });
    expect(result).toMatchObject({ status: "meet-and-greet", version: 3, visitId: "visit-1", placementId: null });
    expect(prisma.workEngagement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subjectRef: "animal-profile:animal-1", dueAt: new Date("2026-09-20T14:00:00Z"), title: "Meet and greet: Ranger with Dana Ortiz" }) }));
    expect(prisma.animalAdoptionApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "meet_and_greet", version: 3 }) }));
  });

  it("refuses an illegal transition, a stale version, and a missing reason for a decline", async () => {
    vi.mocked(prisma.animalAdoptionApplication.findFirst).mockResolvedValue(app("submitted") as never);
    await expect(transitionAdoptionApplicationCommand({ organizationId: ORG, actor: ACTOR, command: { applicationId: "app-1", to: "approved", expectedVersion: 2 } })).rejects.toMatchObject({ code: "illegal_transition" });
    await expect(transitionAdoptionApplicationCommand({ organizationId: ORG, actor: ACTOR, command: { applicationId: "app-1", to: "screening", expectedVersion: 1 } })).rejects.toMatchObject({ code: "stale_version" });
    await expect(transitionAdoptionApplicationCommand({ organizationId: ORG, actor: ACTOR, command: { applicationId: "app-1", to: "withdrawn", expectedVersion: 2 } })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("approval reserves the animal exclusively and marks the listing pending", async () => {
    vi.mocked(prisma.animalAdoptionApplication.findFirst).mockResolvedValue(app("home-check" as never) as never);
    vi.mocked(prisma.animalAdoptionApplication.findFirst).mockResolvedValue({ ...app("home_check"), status: "home_check" } as never);
    vi.mocked(prisma.animalCustodyEpisode.findFirst).mockResolvedValue({ id: "ep-1", legalHoldActive: false } as never);
    vi.mocked(prisma.animalPlacement.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.animalPlacement.create).mockResolvedValue({ id: "pl-1" } as never);
    const result = await transitionAdoptionApplicationCommand({ organizationId: ORG, actor: ACTOR, now: NOW, command: { applicationId: "app-1", to: "approved", expectedVersion: 2 } });
    expect(result).toMatchObject({ status: "approved", placementId: "pl-1" });
    expect(prisma.animalPlacement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ animalProfileId: "animal-1", applicationId: "app-1", status: "reserved" }) }));
    expect(prisma.adoptableAnimal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "pending" } }));
  });

  it("refuses to promise the same animal twice, or one that is held or not ready", async () => {
    vi.mocked(prisma.animalAdoptionApplication.findFirst).mockResolvedValue({ ...app("home_check"), status: "home_check" } as never);
    vi.mocked(prisma.animalCustodyEpisode.findFirst).mockResolvedValue({ id: "ep-1", legalHoldActive: false } as never);
    vi.mocked(prisma.animalPlacement.findFirst).mockResolvedValue({ id: "pl-9", application: { applicantName: "Sam Lee" } } as never);
    await expect(transitionAdoptionApplicationCommand({ organizationId: ORG, actor: ACTOR, command: { applicationId: "app-1", to: "approved", expectedVersion: 2 } })).rejects.toMatchObject({ code: "already_reserved", message: expect.stringContaining("Sam Lee") });
    vi.mocked(prisma.animalPlacement.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.animalCustodyEpisode.findFirst).mockResolvedValue({ id: "ep-1", legalHoldActive: true } as never);
    await expect(transitionAdoptionApplicationCommand({ organizationId: ORG, actor: ACTOR, command: { applicationId: "app-1", to: "approved", expectedVersion: 2 } })).rejects.toMatchObject({ code: "hold_active" });
    vi.mocked(prisma.animalAdoptionApplication.findFirst).mockResolvedValue({ ...app("home_check", "in_care"), status: "home_check" } as never);
    await expect(transitionAdoptionApplicationCommand({ organizationId: ORG, actor: ACTOR, command: { applicationId: "app-1", to: "approved", expectedVersion: 2 } })).rejects.toMatchObject({ code: "animal_not_ready" });
    expect(prisma.animalPlacement.create).not.toHaveBeenCalled();
  });
});

describe("completeAdoptionPlacement", () => {
  function approved() {
    return { id: "app-1", status: "approved", version: 4, applicantName: "Dana Ortiz", applicantContactRef: null, animalProfileId: "animal-1", placement: { id: "pl-1", status: "reserved" }, animal: { name: "Ranger", animalRef: "AN-1" } };
  }

  it("activates the placement, records the fee as a donation, closes custody, withdraws the listing and frees housing", async () => {
    vi.mocked(prisma.animalAdoptionApplication.findFirst).mockResolvedValue(approved() as never);
    vi.mocked(prisma.animalCustodyEpisode.findFirst).mockResolvedValue({ id: "ep-1", legalHoldActive: false, currentStage: "placement_ready", version: 5 } as never);
    vi.mocked(prisma.storefrontDonation.create).mockResolvedValue({ id: "don-1" } as never);
    const result = await completeAdoptionPlacement({ organizationId: ORG, storefrontId: "sf-1", actor: ACTOR, now: NOW, command: { applicationId: "app-1", expectedVersion: 4, fee: { amount: 150, currency: "usd", donorEmail: "dana@example.org" } } });
    expect(result).toEqual({ placementId: "pl-1", donationId: "don-1" });
    expect(prisma.storefrontDonation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ storefrontId: "sf-1", amount: 150, currency: "USD", donorEmail: "dana@example.org", message: expect.stringContaining("Ranger") }) }));
    expect(prisma.animalPlacement.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "active", paymentRef: "don-1", adoptionFeeAmount: 150 }) }));
    expect(prisma.animalCustodyEpisode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currentStage: "outcome_recorded", outcomeType: "adoption", closedAt: NOW, version: 6 }) }));
    expect(prisma.animalCustodyEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sequence: 6, toStage: "outcome_recorded" }) }));
    expect(prisma.animalProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lifecycleStatus: "placed" }) }));
    expect(prisma.adoptableAnimal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "adopted", adoptedAt: NOW, publishedAt: null } }));
    expect(prisma.resourceCapacityAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ demandRef: "AN-1", releasedAt: null }), data: { releasedAt: NOW, releaseReason: "left-care" } }));
  });

  it("refuses without an approved reservation, under a hold, or with a malformed fee", async () => {
    vi.mocked(prisma.animalAdoptionApplication.findFirst).mockResolvedValue({ ...approved(), status: "screening", placement: null } as never);
    await expect(completeAdoptionPlacement({ organizationId: ORG, storefrontId: "sf-1", actor: ACTOR, command: { applicationId: "app-1", expectedVersion: 4 } })).rejects.toMatchObject({ code: "illegal_transition" });
    vi.mocked(prisma.animalAdoptionApplication.findFirst).mockResolvedValue(approved() as never);
    vi.mocked(prisma.animalCustodyEpisode.findFirst).mockResolvedValue({ id: "ep-1", legalHoldActive: true, currentStage: "care", version: 1 } as never);
    await expect(completeAdoptionPlacement({ organizationId: ORG, storefrontId: "sf-1", actor: ACTOR, command: { applicationId: "app-1", expectedVersion: 4 } })).rejects.toMatchObject({ code: "hold_active" });
    await expect(completeAdoptionPlacement({ organizationId: ORG, storefrontId: "sf-1", actor: ACTOR, command: { applicationId: "app-1", expectedVersion: 4, fee: { amount: 0, currency: "USD", donorEmail: "x@y" } } })).rejects.toMatchObject({ code: "invalid_input" });
    expect(prisma.storefrontDonation.create).not.toHaveBeenCalled();
  });
});

describe("cancelAdoptionReservation and returnAdoptedAnimal", () => {
  it("cancels a reservation with a reason and re-lists the animal", async () => {
    vi.mocked(prisma.animalAdoptionApplication.findFirst).mockResolvedValue({ id: "app-1", status: "approved", version: 4, animalProfileId: "animal-1", placement: { id: "pl-1", status: "reserved" } } as never);
    await cancelAdoptionReservation({ organizationId: ORG, actor: ACTOR, command: { applicationId: "app-1", expectedVersion: 4, reason: "Applicant moved abroad" } });
    expect(prisma.animalPlacement.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled", returnReason: "Applicant moved abroad" }) }));
    expect(prisma.animalAdoptionApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "closed" }) }));
    expect(prisma.adoptableAnimal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "pending" }), data: { status: "available" } }));
  });

  it("a return closes the placement, opens a new custody episode as a return, and keeps history", async () => {
    vi.mocked(prisma.animalPlacement.findFirst).mockResolvedValue({ id: "pl-1", status: "active", version: 2, animalProfileId: "animal-1", animal: { animalRef: "AN-1", name: "Ranger" } } as never);
    vi.mocked(prisma.animalCustodyEpisode.count).mockResolvedValue(1);
    vi.mocked(prisma.animalCustodyEpisode.create).mockResolvedValue({ id: "ep-2" } as never);
    const result = await returnAdoptedAnimal({ organizationId: ORG, actor: ACTOR, allowedHousingKinds: ["kennel"], now: NOW, command: { placementId: "pl-1", expectedVersion: 2, reason: "Landlord refused" } });
    expect(result).toEqual({ placementId: "pl-1", custodyEpisodeId: "ep-2", housed: false });
    expect(prisma.animalPlacement.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "returned", returnReason: "Landlord refused", returnedAt: NOW }) }));
    expect(prisma.animalCustodyEpisode.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ episodeNumber: 2, intakeType: "return", currentStage: "intake" }) }));
    expect(prisma.animalProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lifecycleStatus: "in_care" }) }));
    expect(prisma.adoptableAnimal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "hold", adoptedAt: null } }));
  });

  it("refuses a return without a reason or on a placement that is not active", async () => {
    await expect(returnAdoptedAnimal({ organizationId: ORG, actor: ACTOR, allowedHousingKinds: [], command: { placementId: "pl-1", expectedVersion: 2, reason: " " } })).rejects.toMatchObject({ code: "invalid_input" });
    vi.mocked(prisma.animalPlacement.findFirst).mockResolvedValue({ id: "pl-1", status: "returned", version: 2, animalProfileId: "animal-1", animal: { animalRef: "AN-1", name: "Ranger" } } as never);
    await expect(returnAdoptedAnimal({ organizationId: ORG, actor: ACTOR, allowedHousingKinds: [], command: { placementId: "pl-1", expectedVersion: 2, reason: "x" } })).rejects.toMatchObject({ code: "illegal_transition" });
  });
});
