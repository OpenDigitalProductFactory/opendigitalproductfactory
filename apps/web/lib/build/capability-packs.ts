import packs from "../../../../packages/dpf-skill-pack/capability-packs.json";

export type BuildStudioCapabilityPackId =
  | "architecture"
  | "design"
  | "implementation"
  | "verification"
  | "review-ship"
  | "recovery";

export type BuildStudioCapabilityPack = {
  id: BuildStudioCapabilityPackId;
  label: string;
  skillIds: string[];
};

const ORDER: BuildStudioCapabilityPackId[] = [
  "architecture",
  "design",
  "implementation",
  "verification",
  "review-ship",
  "recovery",
];

const PACKS = packs as BuildStudioCapabilityPack[];
const PACKS_BY_ID = new Map<BuildStudioCapabilityPackId, BuildStudioCapabilityPack>(
  PACKS.map((pack) => [pack.id, pack]),
);

export function listBuildStudioCapabilityPacks(): BuildStudioCapabilityPack[] {
  return ORDER.map((id) => getBuildStudioCapabilityPack(id));
}

export function getBuildStudioCapabilityPack(id: BuildStudioCapabilityPackId): BuildStudioCapabilityPack {
  const pack = PACKS_BY_ID.get(id);
  if (!pack) {
    throw new Error(`Missing Build Studio capability pack: ${id}`);
  }
  return pack;
}
