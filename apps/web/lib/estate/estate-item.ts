type EstateEvidence = {
  rawVendor?: string | null;
  rawProductName?: string | null;
  rawPackageName?: string | null;
  rawVersion?: string | null;
  normalizationStatus?: string | null;
  normalizationConfidence?: number | null;
  lastSeenAt?: Date | string | null;
};

type EstateCounts = {
  fromRelationships?: number;
  toRelationships?: number;
};

type EstateTaxonomyNode = {
  name: string;
  nodeId: string;
};

type EstateQualityIssue = {
  issueType: string;
  severity?: string | null;
  status?: string | null;
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
  firstSeenAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
  attributionStatus?: string | null;
  attributionConfidence?: number | null;
  taxonomyNode?: EstateTaxonomyNode | null;
  _count?: EstateCounts | null;
  softwareEvidence?: EstateEvidence[] | null;
  qualityIssues?: EstateQualityIssue[] | null;
};

export type EstateSupportTone = "good" | "warn" | "danger" | "neutral";
export type EstateIndicatorTone = EstateSupportTone;

export type EstatePostureBadge = {
  label: string;
  tone: EstateIndicatorTone;
};

export type EstateItem = {
  id: string;
  name: string;
  entityKey: string;
  iconKey: string;
  technicalClassLabel: string;
  manufacturerLabel: string;
  modelLabel: string | null;
  identityLabel: string;
  identityConfidenceLabel: string;
  identityConfidenceTone: EstateIndicatorTone;
  versionLabel: string;
  versionSourceLabel: string;
  supportStatus: string;
  supportStatusLabel: string;
  supportTone: EstateSupportTone;
  supportSummaryLabel: string;
  advisorySummaryLabel: string;
  versionConfidenceLabel: string;
  versionConfidenceTone: EstateIndicatorTone;
  freshnessLabel: string;
  freshnessTone: EstateIndicatorTone;
  blastRadiusLabel: string;
  postureBadges: EstatePostureBadge[];
  openIssueCount: number;
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
  container: "Container",
  application: "Application",
  database: "Database",
  monitoring_service: "Monitoring Service",
  network_client: "Network Client",
  network_interface: "Network Interface",
  subnet: "Subnet",
  vlan: "VLAN",
  ai_service: "AI Service",
  docker_host: "Docker Host",
  runtime: "Runtime",
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
  container: "container",
  application: "application",
  database: "database",
  monitoring_service: "monitoring",
  network_client: "device",
  network_interface: "network",
  subnet: "network",
  vlan: "network",
  ai_service: "ai",
  docker_host: "host",
  runtime: "service",
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

function normalizeEvidenceStatus(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? null;
  return normalized && normalized.length > 0 ? normalized : null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getOpenIssues(source: EstateItemSource): EstateQualityIssue[] {
  return (source.qualityIssues ?? []).filter((issue) => (issue.status ?? "open") === "open");
}

function findPrimaryEvidence(source: EstateItemSource): EstateEvidence | undefined {
  return source.softwareEvidence?.find((evidence) =>
    evidence.rawVendor
    || evidence.rawProductName
    || evidence.rawPackageName
    || evidence.rawVersion
    || evidence.normalizationStatus
  );
}

function deriveIdentity(
  source: EstateItemSource,
  evidence: EstateEvidence | undefined,
): {
  label: string;
  confidenceLabel: string;
  confidenceTone: EstateIndicatorTone;
  modelLabel: string | null;
} {
  const normalizationStatus = normalizeEvidenceStatus(evidence?.normalizationStatus);
  const normalizationConfidence = typeof evidence?.normalizationConfidence === "number"
    ? evidence.normalizationConfidence
    : null;
  const evidenceIdentity = evidence?.rawProductName?.trim()
    || evidence?.rawPackageName?.trim()
    || null;
  const modelLabel = source.productModel?.trim() || evidenceIdentity || null;
  const label = modelLabel || source.name;

  if (source.productModel?.trim() || normalizationStatus === "normalized" || normalizationStatus === "verified") {
    return {
      label,
      confidenceLabel: "Normalized identity",
      confidenceTone: "good",
      modelLabel,
    };
  }

  if (normalizationStatus === "raw_only" || normalizationStatus === "observed") {
    return {
      label,
      confidenceLabel: "Observed identity",
      confidenceTone: "neutral",
      modelLabel,
    };
  }

  if (
    normalizationStatus === "needs_review"
    || normalizationStatus === "ambiguous"
    || normalizationStatus === "conflict"
    || ((normalizationConfidence !== null && normalizationConfidence < 0.5) && !evidenceIdentity)
  ) {
    return {
      label,
      confidenceLabel: "Identity needs review",
      confidenceTone: "warn",
      modelLabel,
    };
  }

  if (evidenceIdentity || source.manufacturer?.trim() || evidence?.rawVendor?.trim()) {
    return {
      label,
      confidenceLabel: "Observed identity",
      confidenceTone: "neutral",
      modelLabel,
    };
  }

  return {
    label,
    confidenceLabel: "Identity needs review",
    confidenceTone: "warn",
    modelLabel,
  };
}

function deriveVersionConfidence(
  source: EstateItemSource,
  evidence: EstateEvidence | undefined,
): { label: string; tone: EstateIndicatorTone } {
  const confidence = typeof evidence?.normalizationConfidence === "number"
    ? evidence.normalizationConfidence
    : null;
  const normalizationStatus = evidence?.normalizationStatus?.trim().toLowerCase() ?? null;

  if (source.normalizedVersion) {
    if ((normalizationStatus === "normalized" || normalizationStatus === "verified") && (confidence ?? 0) >= 0.85) {
      return { label: "High confidence version", tone: "good" };
    }
    return { label: "Normalized version", tone: "neutral" };
  }

  if (source.observedVersion || evidence?.rawVersion) {
    return { label: "Observed version only", tone: "warn" };
  }

  return { label: "Version unknown", tone: "neutral" };
}

function deriveVersionSource(source: EstateItemSource, evidence: EstateEvidence | undefined): string {
  if (source.normalizedVersion) {
    return "Normalized from software evidence";
  }

  if (source.observedVersion || evidence?.rawVersion) {
    return "Observed from discovery evidence";
  }

  return "Version not verified";
}

function deriveFreshness(source: EstateItemSource, evidence: EstateEvidence | undefined): {
  label: string;
  tone: EstateIndicatorTone;
} {
  const lastSeenAt = toDate(evidence?.lastSeenAt) ?? toDate(source.lastSeenAt) ?? toDate(source.firstSeenAt);
  if (!lastSeenAt) {
    return { label: "Freshness unknown", tone: "neutral" };
  }

  const ageMs = Date.now() - lastSeenAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays <= 7) {
    return { label: "Seen recently", tone: "good" };
  }
  if (ageDays <= 30) {
    return { label: "Seen this month", tone: "neutral" };
  }
  return { label: "Stale evidence", tone: "danger" };
}

function deriveBlastRadius(source: EstateItemSource): string {
  const upstreamCount = source._count?.fromRelationships ?? 0;
  const downstreamCount = source._count?.toRelationships ?? 0;

  if (downstreamCount > 0) {
    return `Failure impacts ${pluralize(downstreamCount, "downstream dependency", "downstream dependencies")}`;
  }
  if (upstreamCount > 0) {
    return `Depends on ${pluralize(upstreamCount, "upstream dependency", "upstream dependencies")}`;
  }
  return "No mapped dependencies";
}

function categorizeIssue(issueType: string): {
  key: string;
  label: (count: number) => string;
  tone: EstateIndicatorTone;
} {
  if (issueType === "gateway_connection_needed") {
    return {
      key: "dependency",
      label: (count) => pluralize(count, "dependency gap", "dependency gaps"),
      tone: "warn",
    };
  }

  if (issueType === "attribution_missing" || issueType === "taxonomy_attribution_low_confidence") {
    return {
      key: "attribution",
      label: (count) => pluralize(count, "attribution gap", "attribution gaps"),
      tone: "warn",
    };
  }

  if (issueType === "stale_entity" || issueType === "stale_relationship") {
    return {
      key: "freshness",
      label: (count) => pluralize(count, "stale signal", "stale signals"),
      tone: "warn",
    };
  }

  if (issueType === "health_alert") {
    return {
      key: "operational",
      label: (count) => pluralize(count, "active alert", "active alerts"),
      tone: "danger",
    };
  }

  if (/vulnerability|advisory|cve/i.test(issueType)) {
    return {
      key: "security",
      label: (count) => pluralize(count, "security finding", "security findings"),
      tone: "danger",
    };
  }

  if (/support|eol|eos/i.test(issueType)) {
    return {
      key: "support",
      label: (count) => pluralize(count, "support risk", "support risks"),
      tone: "warn",
    };
  }

  if (/update|drift/i.test(issueType)) {
    return {
      key: "updates",
      label: (count) => pluralize(count, "update gap", "update gaps"),
      tone: "warn",
    };
  }

  return {
    key: "other",
    label: (count) => pluralize(count, "estate issue", "estate issues"),
    tone: "warn",
  };
}

function derivePostureBadges(source: EstateItemSource): EstatePostureBadge[] {
  const issues = getOpenIssues(source);
  if (issues.length === 0) {
    return [];
  }

  const grouped = new Map<string, { count: number; label: (count: number) => string; tone: EstateIndicatorTone }>();
  for (const issue of issues) {
    const category = categorizeIssue(issue.issueType);
    const existing = grouped.get(category.key);
    if (existing) {
      existing.count += 1;
      if (issue.severity === "error" || issue.severity === "critical") {
        existing.tone = "danger";
      }
      continue;
    }
    grouped.set(category.key, {
      count: 1,
      label: category.label,
      tone: issue.severity === "error" || issue.severity === "critical" ? "danger" : category.tone,
    });
  }

  const order = ["dependency", "attribution", "freshness", "operational", "security", "support", "updates", "other"];
  return [...grouped.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([, value]) => ({
      label: value.label(value.count),
      tone: value.tone,
    }));
}

function countIssueCategory(source: EstateItemSource, key: string): number {
  return getOpenIssues(source)
    .map((issue) => categorizeIssue(issue.issueType).key)
    .filter((issueKey) => issueKey === key)
    .length;
}

function deriveSupportSummary(source: EstateItemSource, normalizedSupportStatus: string): string {
  if (normalizedSupportStatus === "supported") {
    return "Covered by vendor support";
  }
  if (normalizedSupportStatus === "nearing_eol") {
    return "Vendor lifecycle is nearing end of support";
  }
  if (normalizedSupportStatus === "unsupported" || normalizedSupportStatus === "eol") {
    return "Vendor lifecycle has ended";
  }
  if (countIssueCategory(source, "support") > 0) {
    return "Support review needed";
  }
  return "Vendor lifecycle not verified";
}

function deriveAdvisorySummary(source: EstateItemSource): string {
  const securityCount = countIssueCategory(source, "security");
  if (securityCount > 0) {
    return `${pluralize(securityCount, "security finding", "security findings")} recorded`;
  }

  const updateCount = countIssueCategory(source, "updates");
  if (updateCount > 0) {
    return `${pluralize(updateCount, "update gap", "update gaps")} tracked`;
  }

  return "No advisory findings recorded";
}

export function createEstateItem(source: EstateItemSource): EstateItem {
  const firstEvidence = findPrimaryEvidence(source);
  const technicalClass = source.technicalClass ?? source.entityType;
  const normalizedSupportStatus = normalizeSupportStatus(source.supportStatus);
  const identity = deriveIdentity(source, firstEvidence);
  const versionConfidence = deriveVersionConfidence(source, firstEvidence);
  const freshness = deriveFreshness(source, firstEvidence);
  const postureBadges = derivePostureBadges(source);

  return {
    id: source.id,
    name: source.name,
    entityKey: source.entityKey,
    iconKey: source.iconKey ?? ICON_KEY_ALIASES[technicalClass] ?? technicalClass,
    technicalClassLabel: TECHNICAL_CLASS_LABELS[technicalClass] ?? formatWords(technicalClass),
    manufacturerLabel: source.manufacturer ?? firstEvidence?.rawVendor ?? "Unknown vendor",
    modelLabel: identity.modelLabel,
    identityLabel: identity.label,
    identityConfidenceLabel: identity.confidenceLabel,
    identityConfidenceTone: identity.confidenceTone,
    versionLabel: source.normalizedVersion ?? source.observedVersion ?? firstEvidence?.rawVersion ?? "Unknown version",
    versionSourceLabel: deriveVersionSource(source, firstEvidence),
    supportStatus: normalizedSupportStatus,
    supportStatusLabel: SUPPORT_STATUS_LABELS[normalizedSupportStatus] ?? formatWords(normalizedSupportStatus),
    supportTone: SUPPORT_STATUS_TONES[normalizedSupportStatus] ?? "neutral",
    supportSummaryLabel: deriveSupportSummary(source, normalizedSupportStatus),
    advisorySummaryLabel: deriveAdvisorySummary(source),
    versionConfidenceLabel: versionConfidence.label,
    versionConfidenceTone: versionConfidence.tone,
    freshnessLabel: freshness.label,
    freshnessTone: freshness.tone,
    blastRadiusLabel: deriveBlastRadius(source),
    postureBadges,
    openIssueCount: getOpenIssues(source).length,
    providerViewLabel: source.providerView ?? "Unassigned",
    taxonomyPath: source.taxonomyNode?.nodeId.replace(/\//g, " / ") ?? null,
    upstreamCount: source._count?.fromRelationships ?? 0,
    downstreamCount: source._count?.toRelationships ?? 0,
    statusLabel: source.status,
  };
}
