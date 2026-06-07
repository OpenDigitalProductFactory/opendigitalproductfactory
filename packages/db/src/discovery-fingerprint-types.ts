export type RedactionStatus = "not_required" | "redacted" | "needs_review" | "blocked_sensitive";

export type BlastRadiusTier = "low" | "medium" | "high" | "customer-critical";

export type FingerprintPolicyDecision = "auto_accept" | "human_review" | "unresolved";

export type FingerprintEvidenceFamily =
  | "container_image"
  | "process_name"
  | "package_name"
  | "snmp"
  | "mdns"
  | "dhcp"
  | "http_banner"
  | "tls_certificate"
  | "prometheus_target"
  | "human_confirmation"
  // Day-one device signals (spec §3c): captured today via ARP + the embedded
  // IEEE OUI library, with no edge-node detection-engine dependency.
  | "mac_oui"
  | "hostname";

export type FingerprintPolicyInput = {
  identityConfidence: number;
  taxonomyConfidence: number;
  candidateMargin: number;
  evidenceFamilies: string[];
  redactionStatus: RedactionStatus;
  blastRadiusTier: BlastRadiusTier;
  hasDeprecatedTaxonomyCandidate: boolean;
  hasManualConflict: boolean;
  hasEstateAmbiguity: boolean;
  affectedEntityCount: number;
};

export type FingerprintPolicyResult = {
  decision: FingerprintPolicyDecision;
  reasons: string[];
};

export type FingerprintRedactionResult = {
  normalizedEvidence: unknown;
  status: RedactionStatus;
  redactedFields: string[];
  blockedReasons: string[];
};
