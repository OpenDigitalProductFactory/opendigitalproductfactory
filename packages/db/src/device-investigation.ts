/**
 * Layer-1 device investigation (spec §4, §8.4; BI-4FACD527).
 *
 * When layer 0 (seed fingerprint rules) cannot identify a device, the AI
 * coworker (Estate Specialist / Portfolio Analyst) investigates: it analyses the
 * OUI/MAC (reusing classifyMac for randomized-MAC + module-vendor detection),
 * applies manufacturer heuristics, and — for genuinely unknown vendors — does
 * manufacturer web research. The coworker:
 *   - AUTO-RESOLVES confident cases by authoring a DRAFT fingerprint rule
 *     (identity + DPPM placement), which then crystallizes down to layer 0.
 *   - ESCALATES exactly ONE specific question to the operator for the
 *     irreducible unknowns — a randomized/locally-administered MAC, or a
 *     module-only OUI (e.g. Sichuan AI-Link "DEFAULT") — with the evidence.
 *
 * This module is the deterministic core: pure, offline, and testable. Web
 * research is an injected dependency so the heuristics are exercised without a
 * network. The coworker dispatch + DiscoveryFingerprintReview persistence are
 * the thin integration layer in recordInvestigationOutcome.
 */

import { classifyMac } from "./discovery-mac-classification";
import { placeDeviceClass } from "./device-placement";
import { recordFingerprintReview } from "./discovery-fingerprint-store";
import type { FingerprintRuleObservation, FingerprintMatchExpression, ResolvedIdentity } from "./discovery-fingerprint-rules";
import { buildCommonsFingerprint, type CommonsFingerprint } from "./fingerprint-commons-contribution";

export type InvestigationOutcome = "auto_resolve" | "escalate" | "dismiss";

export type EscalationReason = "randomized_mac" | "module_only_oui" | "unknown_vendor";

export type EscalationQuestion = {
  reason: EscalationReason;
  /** ONE specific question for the operator — never an open-ended dump. */
  question: string;
  /** The evidence the operator needs to answer (PII-free shape). */
  evidence: Record<string, unknown>;
};

/** A coworker-authored draft fingerprint rule (status: "draft" — fixture-gated before activation). */
export type DraftFingerprintRule = {
  ruleKey: string;
  status: "draft";
  source: "coworker_investigation";
  requiredEvidenceFamilies: string[];
  matchExpression: FingerprintMatchExpression;
  resolvedIdentity: ResolvedIdentity;
  /** Semantic taxonomy nodeId string (resolved to a cuid at persist), or null if unplaceable. */
  taxonomyNodeId: string | null;
  identityConfidence: number;
  taxonomyConfidence: number;
};

export type InvestigationResult = {
  outcome: InvestigationOutcome;
  rationale: string;
  draftRule?: DraftFingerprintRule;
  escalation?: EscalationQuestion;
  /**
   * Privacy-scrubbed, generalizable vendor->device-class fingerprint safe to
   * contribute to the shared commons (BI-57C27DE1). Null unless the device is a
   * clean, non-proprietary known — proprietary/unplaceable devices stay local.
   */
  commonsContribution?: CommonsFingerprint | null;
};

export type WebSearchResult = { title: string; url: string; snippet: string };
export type WebResearchFn = (query: string) => Promise<WebSearchResult[]>;

export type InvestigationOptions = {
  /** Injected web research (production: searchPublicWeb). Omitted → heuristics only. */
  webResearch?: WebResearchFn;
};

/**
 * Extended vendor → device-class heuristics the coworker knows but the seed
 * catalog hasn't crystallized yet. A confident hit here auto-resolves into a
 * draft rule. Keys are lower-cased vendor substrings (matched against the
 * observation's lower-cased vendor). Distinct from the seed: these are the
 * layer-1 "I recognise this brand" knowledge that becomes layer-0 over time.
 */
const VENDOR_CLASS_HEURISTICS: ReadonlyArray<{ match: string; name: string; deviceClass: string }> = [
  { match: "honeywell", name: "Honeywell thermostat", deviceClass: "thermostat" },
  { match: "ecobee", name: "ecobee thermostat", deviceClass: "thermostat" },
  { match: "ring", name: "Ring doorbell / camera", deviceClass: "doorbell_camera" },
  { match: "wyze", name: "Wyze camera", deviceClass: "ip_camera" },
  { match: "hikvision", name: "Hikvision camera", deviceClass: "ip_camera" },
  { match: "dahua", name: "Dahua camera", deviceClass: "ip_camera" },
  { match: "axis communications", name: "Axis camera", deviceClass: "ip_camera" },
  { match: "sonos", name: "Sonos speaker", deviceClass: "smart_speaker" },
  { match: "google", name: "Google Nest speaker", deviceClass: "smart_speaker" },
  { match: "philips", name: "Philips Hue lighting", deviceClass: "smart_bulb" },
  { match: "lutron", name: "Lutron lighting", deviceClass: "light_switch" },
  { match: "cisco", name: "Cisco network device", deviceClass: "switch" },
  { match: "netgear", name: "Netgear network device", deviceClass: "router" },
  { match: "aruba", name: "Aruba access point", deviceClass: "access_point" },
  { match: "mikrotik", name: "MikroTik router", deviceClass: "router" },
  { match: "dell", name: "Dell client / workstation", deviceClass: "client_endpoint" },
  { match: "lenovo", name: "Lenovo client", deviceClass: "client_endpoint" },
  { match: "hewlett packard", name: "HP client", deviceClass: "client_endpoint" },
  { match: "asustek", name: "ASUS client", deviceClass: "client_endpoint" },
  { match: "raspberry pi", name: "Raspberry Pi", deviceClass: "client_endpoint" },
];

function ev(observation: FingerprintRuleObservation): Record<string, unknown> {
  const e = observation.normalizedEvidence;
  return e && typeof e === "object" ? (e as Record<string, unknown>) : {};
}

function ruleKeyFor(matchValue: string, deviceClass: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `investigated:${slug(matchValue)}-${slug(deviceClass)}`;
}

function draftRuleFor(
  matchValue: string,
  name: string,
  deviceClass: string,
  options: {
    matchPath?: string;
    evidenceFamily?: string;
    vendor?: string | null;
  } = {},
): DraftFingerprintRule {
  const placement = placeDeviceClass(deviceClass);
  const matchPath = options.matchPath ?? "vendor";
  const evidenceFamily = options.evidenceFamily ?? "mac_oui";
  return {
    ruleKey: ruleKeyFor(matchValue, deviceClass),
    status: "draft",
    source: "coworker_investigation",
    requiredEvidenceFamilies: [evidenceFamily],
    matchExpression: { all: [{ type: "contains", path: matchPath, value: matchValue }] },
    resolvedIdentity: {
      kind: "device",
      name,
      ...(options.vendor ? { vendor: options.vendor } : {}),
      deviceClass,
    },
    taxonomyNodeId: placement.taxonomyNodeId,
    // Draft confidence sits just below the layer-0 auto-apply bar: a draft must
    // pass its own fixtures (and, for hive rules, curation) before activation.
    identityConfidence: 0.85,
    taxonomyConfidence: placement.taxonomyNodeId ? 0.9 : 0,
  };
}

function getStringEvidence(evidence: Record<string, unknown>, key: string): string | null {
  const value = evidence[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function classifyFromObservedSignals(
  evidence: Record<string, unknown>,
): {
  matchValue: string;
  matchPath: string;
  evidenceFamily: string;
  name: string;
  deviceClass: string;
  vendor?: string | null;
} | null {
  const observedName = getStringEvidence(evidence, "observedName");
  const hostname = getStringEvidence(evidence, "hostname");
  const vendor = getStringEvidence(evidence, "vendor");
  const combined = `${observedName ?? ""} ${hostname ?? ""}`.trim();

  if (/\bprinter\b/.test(combined) || /^npi[a-z0-9-]*/.test(hostname ?? "")) {
    return {
      matchValue: observedName && /\bprinter\b/.test(observedName) ? "printer" : "npi",
      matchPath: observedName && /\bprinter\b/.test(observedName) ? "observedName" : "hostname",
      evidenceFamily: observedName && /\bprinter\b/.test(observedName) ? "observed_name" : "hostname",
      name: "Printer",
      deviceClass: "printer",
    };
  }

  if (/\boven\b/.test(combined)) {
    const whirlpool = vendor && /\bwhirlpool\b/.test(vendor);
    return {
      matchValue: "oven",
      matchPath: "observedName",
      evidenceFamily: "observed_name",
      name: whirlpool ? "Whirlpool oven" : "Oven",
      deviceClass: "oven",
      vendor: whirlpool ? "Whirlpool Corporation" : null,
    };
  }

  return null;
}

/**
 * Investigate a layer-0 miss. Deterministic heuristics run first; web research
 * (when injected) is the fallback for genuinely unknown vendors.
 *
 * The exported entry attaches a privacy-scrubbed commons contribution (BI-57C27DE1)
 * derived ONLY from the draft rule's generalizable {vendor, deviceClass} — never
 * from the observation's IP/host/MAC. When the device is proprietary/unplaceable
 * (no draft rule, no clean class) the contribution is null and nothing is shared.
 */
export async function investigateUnidentifiedDevice(
  observation: FingerprintRuleObservation,
  options: InvestigationOptions = {},
): Promise<InvestigationResult> {
  const result = await investigateUnidentifiedDeviceInner(observation, options);
  const identity = result.draftRule?.resolvedIdentity;
  // Vendor source: the resolved identity's vendor, else the observation's OUI
  // vendor (a generalizable manufacturer string — never an identifier).
  const observedVendor = typeof ev(observation).vendor === "string" ? (ev(observation).vendor as string) : null;
  const commonsContribution = identity
    ? buildCommonsFingerprint({
        vendor: identity.vendor ?? observedVendor,
        deviceClass: identity.deviceClass ?? null,
      })
    : null;
  return { ...result, commonsContribution };
}

async function investigateUnidentifiedDeviceInner(
  observation: FingerprintRuleObservation,
  options: InvestigationOptions = {},
): Promise<InvestigationResult> {
  const e = ev(observation);
  const vendor = typeof e.vendor === "string" ? e.vendor : null;
  const mac = typeof e.mac === "string" ? e.mac : null;
  const macInfo = classifyMac(mac, vendor);
  const oui = typeof e.oui === "string" ? e.oui : macInfo.oui;

  // 1. Randomized / locally-administered MAC — OUI is synthetic. Irreducible
  //    without a stable identifier. Escalate ONE question.
  if (macInfo.randomized || (typeof e.randomized === "boolean" && e.randomized)) {
    return {
      outcome: "escalate",
      rationale:
        "Locally-administered (randomized) MAC — the OUI identifies nobody (RFC 7844 / IEEE U/L bit). " +
        "No stable hardware identifier to fingerprint.",
      escalation: {
        reason: "randomized_mac",
        question:
          "This device uses a randomized MAC, so its vendor cannot be inferred. " +
          "What is it (e.g. a phone with private Wi-Fi, a guest device)? A stable hostname or " +
          "DHCP fingerprint would let us identify it automatically next time.",
        evidence: { oui, randomized: true, hostname: e.hostname ?? null },
      },
    };
  }

  // 2. Module-only OUI (Espressif / Sichuan AI-Link / FN-Link / Tuya) — the OUI
  //    names the radio module, not the finished device. Needs corroboration.
  const moduleVendor = macInfo.moduleVendor ?? (typeof e.moduleVendor === "string" ? e.moduleVendor : null);
  if (moduleVendor) {
    return {
      outcome: "escalate",
      rationale:
        `Module/OEM-radio vendor (${moduleVendor}) — the OUI names the embedded module, not the device brand. ` +
        "OUI alone cannot resolve the product.",
      escalation: {
        reason: "module_only_oui",
        question:
          `This device's network module is made by ${moduleVendor} (an OEM radio used inside many brands), ` +
          "so the manufacturer can't be inferred from the MAC alone. What product is it? " +
          "Its hostname or a DHCP vendor-class (Option 60) would let us fingerprint it automatically.",
        evidence: { oui, moduleVendor, hostname: e.hostname ?? null },
      },
    };
  }

  // 3. Corroborating observed-name / hostname signal — useful when the OUI
  //    names an OEM radio/module maker, but the network label says what the
  //    finished device class is. This classifies and places; it does not invent
  //    exact make/model identity.
  const signalHit = classifyFromObservedSignals(e);
  if (signalHit) {
    return {
      outcome: "auto_resolve",
      rationale: `Recognised observed signal "${signalHit.matchValue}" → ${signalHit.deviceClass}.`,
      draftRule: draftRuleFor(signalHit.matchValue, signalHit.name, signalHit.deviceClass, {
        matchPath: signalHit.matchPath,
        evidenceFamily: signalHit.evidenceFamily,
        vendor: signalHit.vendor,
      }),
    };
  }

  // 4. Known-brand heuristic — the coworker recognises the vendor. Auto-resolve
  //    by authoring a draft rule (crystallizes to layer 0 after fixtures pass).
  if (vendor) {
    const hit = VENDOR_CLASS_HEURISTICS.find((h) => vendor.includes(h.match));
    if (hit) {
      return {
        outcome: "auto_resolve",
        rationale: `Recognised vendor "${vendor}" → ${hit.deviceClass} via manufacturer heuristic.`,
        draftRule: draftRuleFor(hit.match, hit.name, hit.deviceClass),
      };
    }
  }

  // 5. Genuinely unknown but resolvable vendor — try web research, then escalate.
  if (vendor && options.webResearch) {
    const results = await options.webResearch(`${vendor} device type manufacturer`);
    const classified = classifyFromWebResearch(results);
    if (classified) {
      return {
        outcome: "auto_resolve",
        rationale: `Web research resolved "${vendor}" → ${classified.deviceClass}.`,
        draftRule: draftRuleFor(vendor.toLowerCase(), classified.name, classified.deviceClass),
      };
    }
  }

  // 5. Unknown vendor, no heuristic, no web hit — escalate ONE question.
  return {
    outcome: "escalate",
    rationale: vendor
      ? `Vendor "${vendor}" is not in the catalog or heuristics, and research was inconclusive.`
      : "No vendor could be resolved from the available signals.",
    escalation: {
      reason: "unknown_vendor",
      question: vendor
        ? `We found a device from "${vendor}" but don't know what kind it is. What is it?`
        : "We found an unidentified device with no resolvable vendor. What is it?",
      evidence: { oui, vendor: vendor ?? null, hostname: e.hostname ?? null },
    },
  };
}

// ── Integration: persist the investigation outcome ──────────────────────────

export type RecordInvestigationClient = {
  discoveryFingerprintReview: { create(args: unknown): Promise<unknown> };
  discoveryFingerprintRule: { upsert(args: unknown): Promise<unknown> };
  taxonomyNode: { findUnique(args: { where: { nodeId: string }; select: { id: true } }): Promise<{ id: string } | null> };
};

export type RecordInvestigationInput = {
  observationId: string;
  reviewerId?: string | null;
  result: InvestigationResult;
};

export type RecordInvestigationSummary = {
  reviewDecision: string;
  nextStatus: string;
  draftRuleKey: string | null;
};

/**
 * Persist a coworker investigation: always records a DiscoveryFingerprintReview
 * (reviewerType "coworker"); for auto-resolutions it also upserts the authored
 * DRAFT rule (status "draft" — never auto-active; it must pass its own fixtures,
 * and for hive rules curation, before activation per spec §6).
 */
export async function recordInvestigationOutcome(
  db: RecordInvestigationClient,
  input: RecordInvestigationInput,
): Promise<RecordInvestigationSummary> {
  const { result } = input;
  let draftRuleKey: string | null = null;

  if (result.outcome === "auto_resolve" && result.draftRule) {
    const draft = result.draftRule;
    let taxonomyCuid: string | null = null;
    if (draft.taxonomyNodeId) {
      const node = await db.taxonomyNode.findUnique({ where: { nodeId: draft.taxonomyNodeId }, select: { id: true } });
      taxonomyCuid = node?.id ?? null;
    }
    const data = {
      status: "draft" as const,
      scope: "local",
      source: draft.source,
      matchExpression: draft.matchExpression,
      requiredEvidenceFamilies: draft.requiredEvidenceFamilies,
      resolvedIdentity: draft.resolvedIdentity,
      taxonomyNodeId: taxonomyCuid,
      identityConfidence: draft.identityConfidence,
      taxonomyConfidence: draft.taxonomyConfidence,
      sourceObservationIds: [input.observationId],
    };
    await db.discoveryFingerprintRule.upsert({
      where: { ruleKey: draft.ruleKey },
      update: data,
      create: { ruleKey: draft.ruleKey, ...data },
    });
    draftRuleKey = draft.ruleKey;
  }

  const decision = result.outcome === "auto_resolve" ? "draft_authored" : result.outcome === "dismiss" ? "dismissed" : "escalated";
  const nextStatus = result.outcome === "auto_resolve" ? "draft" : result.outcome === "dismiss" ? "dismissed" : "escalated";

  await recordFingerprintReview(db, {
    observationId: input.observationId,
    reviewerType: "coworker",
    reviewerId: input.reviewerId ?? null,
    decision,
    reason: result.rationale,
    nextStatus,
    auditPayload: {
      outcome: result.outcome,
      rationale: result.rationale,
      ...(result.escalation ? { escalation: result.escalation } : {}),
      ...(draftRuleKey ? { draftRuleKey } : {}),
    },
  });

  return { reviewDecision: decision, nextStatus, draftRuleKey };
}

/** Light keyword classification over web-search snippets (no LLM needed for the deterministic path). */
function classifyFromWebResearch(results: WebSearchResult[]): { name: string; deviceClass: string } | null {
  const text = results
    .map((r) => `${r.title} ${r.snippet}`)
    .join(" ")
    .toLowerCase();
  const patterns: Array<{ kw: RegExp; deviceClass: string; name: string }> = [
    { kw: /\b(ip )?camera|surveillance|nvr\b/, deviceClass: "ip_camera", name: "Camera" },
    { kw: /thermostat|hvac/, deviceClass: "thermostat", name: "Thermostat" },
    { kw: /smart plug|smart outlet/, deviceClass: "smart_plug", name: "Smart plug" },
    { kw: /smart bulb|smart light/, deviceClass: "smart_bulb", name: "Smart bulb" },
    { kw: /smart lock|door lock/, deviceClass: "smart_lock", name: "Smart lock" },
    { kw: /speaker|voice assistant/, deviceClass: "smart_speaker", name: "Smart speaker" },
    { kw: /router|switch|access point|gateway/, deviceClass: "router", name: "Network device" },
    { kw: /refrigerator|washer|dryer|dishwasher|appliance/, deviceClass: "smart_appliance", name: "Appliance" },
  ];
  const hit = patterns.find((p) => p.kw.test(text));
  return hit ? { name: hit.name, deviceClass: hit.deviceClass } : null;
}
