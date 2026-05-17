import type { DecisionPerspectiveProfile } from "./types";
import { PLAN_READINESS_DOMAIN_CLASS } from "./types";

const snapshotDate = new Date("2026-05-17T00:00:00.000Z");

const DEFAULT_AUTONOMY_POLICY = {
  allowRecommendation: true,
  allowArbitration: false,
  maxRiskForArbitration: "low" as const,
  minimumConfidenceForRecommendation: 0.55,
  minimumConfidenceForArbitration: 0.85,
};

export const DPF_ORGANIZATIONAL_PRINCIPLES_PROFILE: DecisionPerspectiveProfile = {
  profileId: "dpf-organizational-principles",
  name: "DPF Organizational Principles",
  kind: "organization",
  scope: {
    domains: ["platform-governance", PLAN_READINESS_DOMAIN_CLASS],
  },
  fallbackProfileId: null,
  defaultResolver: { type: "build-studio-owner" },
  autonomyPolicy: DEFAULT_AUTONOMY_POLICY,
  currentVersion: {
    versionId: "dpf-organizational-principles-v1",
    versionNumber: 1,
    materialFingerprint: "seed:dpf-organizational-principles:v1",
    changeSummary: "Initial organizational principle fallback profile.",
    createdAt: snapshotDate,
  },
};

export const DPF_PRODUCT_DOCTRINE_PROFILE: DecisionPerspectiveProfile = {
  profileId: "dpf-product-doctrine",
  name: "DPF Product Doctrine",
  kind: "platform",
  scope: {
    domains: ["platform-product", PLAN_READINESS_DOMAIN_CLASS],
  },
  fallbackProfileId: DPF_ORGANIZATIONAL_PRINCIPLES_PROFILE.profileId,
  defaultResolver: { type: "build-studio-owner" },
  autonomyPolicy: DEFAULT_AUTONOMY_POLICY,
  currentVersion: {
    versionId: "dpf-product-doctrine-v1",
    versionNumber: 1,
    materialFingerprint: "seed:dpf-product-doctrine:v1",
    changeSummary: "Initial DPF product doctrine fallback profile.",
    createdAt: snapshotDate,
  },
};

export const MARK_DPF_PLATFORM_PROFILE: DecisionPerspectiveProfile = {
  profileId: "mark-dpf-platform",
  name: "Mark / DPF Platform",
  kind: "platform",
  scope: {
    domains: ["platform-product", PLAN_READINESS_DOMAIN_CLASS],
  },
  fallbackProfileId: DPF_PRODUCT_DOCTRINE_PROFILE.profileId,
  defaultResolver: { type: "build-studio-owner" },
  autonomyPolicy: DEFAULT_AUTONOMY_POLICY,
  currentVersion: {
    versionId: "mark-dpf-platform-v1",
    versionNumber: 1,
    materialFingerprint: "seed:mark-dpf-platform:v1",
    changeSummary: "Initial Mark / DPF platform perspective profile.",
    createdAt: snapshotDate,
  },
};
