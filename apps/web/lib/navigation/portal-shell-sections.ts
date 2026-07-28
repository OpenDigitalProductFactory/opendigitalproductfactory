export type PortalShellSectionKey =
  | "workspace"
  | "business"
  | "products"
  | "delivery"
  | "platform"
  | "knowledge";

export interface PortalShellSectionDefinition {
  key: PortalShellSectionKey;
  label: string;
  description: string;
}

export const PORTAL_SHELL_SECTIONS: readonly PortalShellSectionDefinition[] = [
  { key: "workspace", label: "Workspace", description: "Current business work and authorized owner/manager performance." },
  { key: "business", label: "Business", description: "Run customer, people, finance, compliance, and portal operations." },
  { key: "products", label: "Products", description: "Guide product lifecycle work from portfolio through delivery." },
  { key: "delivery", label: "Delivery", description: "Build, ship, and track delivery work from one operator home." },
  { key: "platform", label: "Platform", description: "Direct AI coworkers and operate the platform itself." },
  { key: "knowledge", label: "Knowledge", description: "Shared knowledge, reference, and documentation." },
];
