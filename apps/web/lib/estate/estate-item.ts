type EstateEvidence = {
  rawVendor?: string | null;
  rawVersion?: string | null;
};

type EstateCounts = {
  fromRelationships?: number;
  toRelationships?: number;
};

type EstateTaxonomyNode = {
  name: string;
  nodeId: string;
};

export type EstateItemSource = {
  id: string;
  entityKey: string;
  name: string;
  entityType: string;
  technicalClass?: string | null;
  iconKey?: string | null;
  manufacturer?: string | null;
  productModel?: string | null;
  observedVersion?: string | null;
  normalizedVersion?: string | null;
  supportStatus?: string | null;
  providerView?: string | null;
  status: string;
  taxonomyNode?: EstateTaxonomyNode | null;
  _count?: EstateCounts | null;
  softwareEvidence?: EstateEvidence[] | null;
};

export type EstateSupportTone = "good" | "warn" | "danger" | "neutral";

export type EstateItem = {
  id: string;
  name: string;
  entityKey: string;
  iconKey: string;
  technicalClassLabel: string;
  manufacturerLabel: string;
  modelLabel: string | null;
  versionLabel: string;
  supportStatus: string;
  supportStatusLabel: string;
  supportTone: EstateSupportTone;
  providerViewLabel: string;
  taxonomyPath: string | null;
  upstreamCount: number;
  downstreamCount: number;
  statusLabel: string;
};

const TECHNICAL_CLASS_LABELS: Record<string, string> = {
  network_gateway: "Network Gateway",
  network_switch: "Network Switch",
  wireless_access_point: "Wireless Access Point",
  media_device: "Media Device",
  security_device: "Security Device",
  facility_device: "Facility Device",
  service: "Service",
  package: "Software Package",
  storage: "Storage",
  host: "Host",
  gateway: "Gateway",
  switch: "Switch",
  access_point: "Access Point",
  router: "Router",
  camera: "Camera",
};

const ICON_KEY_ALIASES: Record<string, string> = {
  network_gateway: "gateway",
  network_switch: "switch",
  wireless_access_point: "wifi",
  access_point: "wifi",
  router: "gateway",
  package: "package",
  service: "service",
  storage: "storage",
  media_device: "media",
  security_device: "security",
  facility_device: "facility",
  camera: "camera",
};

const SUPPORT_STATUS_LABELS: Record<string, string> = {
  supported: "Supported",
  nearing_eol: "Nearing EOL",
  unsupported: "Unsupported",
  eol: "End of Life",
  unknown: "Unknown",
};

const SUPPORT_STATUS_TONES: Record<string, EstateSupportTone> = {
  supported: "good",
  nearing_eol: "warn",
  unsupported: "danger",
  eol: "danger",
  unknown: "neutral",
};

function formatWords(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function normalizeSupportStatus(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "unknown";
  return normalized.length > 0 ? normalized : "unknown";
}

export function createEstateItem(source: EstateItemSource): EstateItem {
  const firstEvidence = source.softwareEvidence?.find((evidence) =>
    evidence.rawVendor || evidence.rawVersion
  );
  const technicalClass = source.technicalClass ?? source.entityType;
  const normalizedSupportStatus = normalizeSupportStatus(source.supportStatus);

  return {
    id: source.id,
    name: source.name,
    entityKey: source.entityKey,
    iconKey: source.iconKey ?? ICON_KEY_ALIASES[technicalClass] ?? technicalClass,
    technicalClassLabel: TECHNICAL_CLASS_LABELS[technicalClass] ?? formatWords(technicalClass),
    manufacturerLabel: source.manufacturer ?? firstEvidence?.rawVendor ?? "Unknown vendor",
    modelLabel: source.productModel ?? null,
    versionLabel: source.normalizedVersion ?? source.observedVersion ?? firstEvidence?.rawVersion ?? "Unknown version",
    supportStatus: normalizedSupportStatus,
    supportStatusLabel: SUPPORT_STATUS_LABELS[normalizedSupportStatus] ?? formatWords(normalizedSupportStatus),
    supportTone: SUPPORT_STATUS_TONES[normalizedSupportStatus] ?? "neutral",
    providerViewLabel: source.providerView ?? "Unassigned",
    taxonomyPath: source.taxonomyNode?.nodeId.replace(/\//g, " / ") ?? null,
    upstreamCount: source._count?.fromRelationships ?? 0,
    downstreamCount: source._count?.toRelationships ?? 0,
    statusLabel: source.status,
  };
}
