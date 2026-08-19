// Pure mappers: Greenhouse Harvest objects → IntegrationImportStagingRecord.
// No DB, no network, no AI — the same discipline as mapRosterToEmployees. The
// review store fingerprints and scrubs sensitive display fields downstream; we
// additionally never place compensation, SSN, or contact PII in displayFields.

import type { IntegrationImportStagingRecord } from "@/lib/integrations/import-staging";

const SOURCE = "greenhouse";

// Minimal shapes — only the fields we read. Harvest returns much more.
export interface HarvestJob {
  id: number;
  name?: string;
  status?: string;
  updated_at?: string | null;
  departments?: Array<{ name?: string }>;
  offices?: Array<{ name?: string }>;
}

export interface HarvestCandidate {
  id: number;
  first_name?: string;
  last_name?: string;
  title?: string | null;
  company?: string | null;
  updated_at?: string | null;
}

export interface HarvestApplication {
  id: number;
  candidate_id?: number;
  status?: string;
  current_stage?: { name?: string } | null;
  source?: { public_name?: string } | null;
  applied_at?: string | null;
  last_activity_at?: string | null;
}

export interface HarvestOffer {
  id: number;
  application_id?: number;
  status?: string;
  starts_at?: string | null;
  updated_at?: string | null;
}

export interface HarvestScorecard {
  id: number;
  application_id?: number;
  overall_recommendation?: string | null;
  submitted_at?: string | null;
}

type Field = { label: string; value: string } | null | undefined | false;

function fields(...items: Field[]): IntegrationImportStagingRecord["displayFields"] {
  return items.filter((f): f is { label: string; value: string } => Boolean(f));
}

function record(
  partial: Omit<IntegrationImportStagingRecord, "sourceProvider" | "ownerSide" | "readOnly">,
): IntegrationImportStagingRecord {
  return { sourceProvider: SOURCE, ownerSide: "external", readOnly: true, ...partial };
}

export function mapJob(job: HarvestJob): IntegrationImportStagingRecord {
  const department = job.departments?.map((d) => d.name).filter(Boolean).join(", ");
  const office = job.offices?.map((o) => o.name).filter(Boolean).join(", ");
  return record({
    entityFamily: "recruiting-job",
    externalId: String(job.id),
    sourceTimestamp: job.updated_at ?? null,
    proposedLocalLink: {
      entityType: "JobRequisition",
      localId: null,
      status: "candidate",
      confidence: "low",
      reason: "Greenhouse job imported for review",
    },
    displayFields: fields(
      job.name != null && { label: "Job", value: job.name },
      job.status != null && { label: "Status", value: job.status },
      Boolean(department) && { label: "Department", value: department as string },
      Boolean(office) && { label: "Office", value: office as string },
    ),
  });
}

export function mapCandidate(candidate: HarvestCandidate): IntegrationImportStagingRecord {
  const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ").trim();
  return record({
    entityFamily: "recruiting-candidate",
    externalId: String(candidate.id),
    sourceTimestamp: candidate.updated_at ?? null,
    proposedLocalLink: {
      entityType: "Candidate",
      localId: null,
      status: "candidate",
      confidence: "low",
      reason: "Greenhouse candidate imported for review",
    },
    displayFields: fields(
      Boolean(name) && { label: "Name", value: name },
      candidate.title != null && { label: "Title", value: candidate.title },
      candidate.company != null && { label: "Company", value: candidate.company },
    ),
  });
}

export function mapApplication(app: HarvestApplication): IntegrationImportStagingRecord {
  return record({
    entityFamily: "recruiting-application",
    externalId: String(app.id),
    sourceTimestamp: app.last_activity_at ?? app.applied_at ?? null,
    proposedLocalLink: {
      entityType: "Application",
      localId: null,
      status: "candidate",
      confidence: "low",
      reason: "Greenhouse application imported for review",
    },
    displayFields: fields(
      app.status != null && { label: "Status", value: app.status },
      app.current_stage?.name != null && { label: "Stage", value: app.current_stage.name },
      app.source?.public_name != null && { label: "Source", value: app.source.public_name },
    ),
  });
}

export function mapOffer(offer: HarvestOffer): IntegrationImportStagingRecord {
  // Deliberately NO compensation fields in displayFields.
  return record({
    entityFamily: "recruiting-offer",
    externalId: String(offer.id),
    sourceTimestamp: offer.updated_at ?? null,
    proposedLocalLink: {
      entityType: "Offer",
      localId: null,
      status: "candidate",
      confidence: "low",
      reason: "Greenhouse offer imported for review",
    },
    displayFields: fields(
      offer.status != null && { label: "Status", value: offer.status },
      offer.starts_at != null && { label: "Start date", value: offer.starts_at },
    ),
  });
}

export function mapScorecard(scorecard: HarvestScorecard): IntegrationImportStagingRecord {
  return record({
    entityFamily: "recruiting-scorecard",
    externalId: String(scorecard.id),
    sourceTimestamp: scorecard.submitted_at ?? null,
    proposedLocalLink: {
      entityType: "Scorecard",
      localId: null,
      status: "candidate",
      confidence: "low",
      reason: "Greenhouse scorecard imported for review",
    },
    displayFields: fields(
      scorecard.overall_recommendation != null && {
        label: "Recommendation",
        value: scorecard.overall_recommendation,
      },
    ),
  });
}

export interface HarvestImportSet {
  jobs?: HarvestJob[];
  candidates?: HarvestCandidate[];
  applications?: HarvestApplication[];
  offers?: HarvestOffer[];
  scorecards?: HarvestScorecard[];
}

/** Map a full pulled set of Harvest objects into staging records, in a stable order. */
export function mapHarvestImportSet(set: HarvestImportSet): IntegrationImportStagingRecord[] {
  return [
    ...(set.jobs ?? []).map(mapJob),
    ...(set.candidates ?? []).map(mapCandidate),
    ...(set.applications ?? []).map(mapApplication),
    ...(set.offers ?? []).map(mapOffer),
    ...(set.scorecards ?? []).map(mapScorecard),
  ];
}
