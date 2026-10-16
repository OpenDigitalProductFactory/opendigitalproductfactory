// Canonical profession vocabulary/data, independent of decision evaluation and DB types.
import professionRegistryData from "../../../../docs/professions/registry.json";

export type ProfessionSource = {
  name: string;
  url: string;
  licenseClass: "open" | "licensed" | "org-supplied";
};

export type ProfessionFamily = {
  professionKey: string;
  label: string;
  roles: string[];
  contextSlugs: string[];
  sources: ProfessionSource[];
  coverageChecklist: string[];
};

export type ProfessionRegistry = {
  version: string;
  description: string;
  families: ProfessionFamily[];
};

export const PROFESSION_REGISTRY = professionRegistryData as ProfessionRegistry;
