// Portable entity contracts.
//
// Hand-written DTOs that mirror the over-the-wire shape of the platform's core
// entities. They are consumed by the mobile app (`apps/mobile`) and the typed
// API client (`@dpf/api-client`), so this file MUST stay free of any Prisma /
// `@dpf/db` import — a portable contract cannot depend on server persistence
// (see docs/superpowers/specs/2026-06-25-platform-consolidation-spine-design.md
// §6.1 and docs/architecture/package-boundaries.md).
//
// Two tiers mirror Prisma's `GetPayload` semantics:
//   * `*Base` types are the scalar-only shape of a model (what `relation: true`
//     yields when a relation is included — Prisma returns the base record, not a
//     further-included payload).
//   * The exported names compose a base with the specific relations the server
//     includes today, so a value that satisfied the previous `Prisma.*GetPayload`
//     alias still satisfies the DTO.
//
// Drift against the live schema is caught server-side by
// apps/web/lib/contracts/entity-contract-drift.ts, which asserts each Prisma
// payload stays assignable to the matching DTO (with `Decimal` mapped to its
// wire form, `number`).

/**
 * A JSON value carried verbatim from a Prisma `Json` column over the wire.
 * Object members are `| undefined` so this stays a structural supertype of
 * Prisma's own `JsonValue` (whose object members are optional), letting server
 * code hand a Prisma JSON value straight to a DTO without a cast.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

// ── Base scalar shapes (no relations included) ──────────────────────────────

export interface PortfolioBase {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rootNodeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  budgetKUsd: number | null;
}

export interface DigitalProductBase {
  id: string;
  productId: string;
  name: string;
  portfolioId: string | null;
  createdAt: Date;
  updatedAt: Date;
  taxonomyNodeId: string | null;
  lifecycleStage: string;
  lifecycleStatus: string;
  version: string;
  description: string | null;
  observationConfig: JsonValue | null;
  coverageStatus: string | null;
  sourceKind: string | null;
}

export interface TaxonomyNodeBase {
  id: string;
  nodeId: string;
  name: string;
  portfolioId: string | null;
  parentId: string | null;
  status: string;
  governance: JsonValue | null;
  description: string | null;
  enrichment: JsonValue | null;
}

export interface EpicPortfolioBase {
  epicId: string;
  portfolioId: string;
}

export interface EpicBase {
  id: string;
  epicId: string;
  title: string;
  description: string | null;
  status: string;
  priority: number | null;
  createdAt: Date;
  updatedAt: Date;
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  scopeRationale: string | null;
  lifecycleTags: string[];
  submittedById: string | null;
  agentId: string | null;
  completedAt: Date | null;
  accountableEmployeeId: string | null;
  claimedById: string | null;
  claimedByAgentId: string | null;
  claimedAt: Date | null;
  claimStatus: string | null;
  upstreamIssueNumber: number | null;
  upstreamIssueUrl: string | null;
  upstreamSyncedAt: Date | null;
  designDoc: JsonValue | null;
  designReview: JsonValue | null;
  decompositionState: JsonValue | null;
  originatingBacklogItemId: string | null;
}

export interface BacklogItemBase {
  id: string;
  itemId: string;
  title: string;
  status: string;
  type: string;
  body: string | null;
  createdAt: Date;
  updatedAt: Date;
  priority: number | null;
  digitalProductId: string | null;
  taxonomyNodeId: string | null;
  epicId: string | null;
  portfolioId: string | null;
  source: string | null;
  workType: string | null;
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  scopeRationale: string | null;
  lifecycleTags: string[];
  triageOutcome: string | null;
  effortSize: string | null;
  proposedOutcome: string | null;
  activeBuildId: string | null;
  activeEpicId: string | null;
  duplicateOfId: string | null;
  resolution: string | null;
  abandonReason: string | null;
  stalenessDetectedAt: Date | null;
  occurrenceCount: number;
  lastSeenAt: Date | null;
  submittedById: string | null;
  completedAt: Date | null;
  agentId: string | null;
  accountableEmployeeId: string | null;
  claimedById: string | null;
  claimedByAgentId: string | null;
  claimedAt: Date | null;
  claimStatus: string | null;
  upstreamIssueNumber: number | null;
  upstreamIssueUrl: string | null;
  upstreamSyncedAt: Date | null;
}

export interface CustomerAccountBase {
  id: string;
  accountId: string;
  name: string;
  status: string;
  website: string | null;
  industry: string | null;
  employeeCount: number | null;
  /** `Decimal?` in Prisma; serialized to a number on the wire (validators use `z.number()`). */
  annualRevenue: number | null;
  currency: string;
  notes: string | null;
  sourceSystem: string | null;
  sourceId: string | null;
  parentAccountId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerContactBase {
  id: string;
  email: string;
  accountId: string;
  isActive: boolean;
  createdAt: Date;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
  source: string | null;
  doNotContact: boolean;
  avatarUrl: string | null;
  updatedAt: Date;
  // `passwordHash` exists on the model but is intentionally omitted from this
  // client-facing contract — it must never travel to a portable consumer.
}

export interface AgentThreadBase {
  id: string;
  userId: string;
  contextKey: string;
  createdAt: Date;
  updatedAt: Date;
  cliSessionId: string | null;
  cliSessionAdapterKind: string | null;
  cliSessionContainerId: string | null;
  cliSessionLastUsedAt: Date | null;
  cliSessionWorkdir: string | null;
  parentThreadId: string | null;
  childCount: number;
  cancelledAt: Date | null;
  idempotencyKey: string | null;
  terminalError: JsonValue | null;
  executionPlan: JsonValue | null;
}

export interface AgentMessageBase {
  id: string;
  threadId: string;
  taskRunId: string | null;
  role: string;
  content: string;
  tone: string | null;
  createdAt: Date;
  agentId: string | null;
  routeContext: string | null;
  providerId: string | null;
  taskType: string | null;
  routedEndpointId: string | null;
}

export interface AgentActionProposalBase {
  id: string;
  proposalId: string;
  threadId: string;
  taskRunId: string | null;
  messageId: string;
  agentId: string;
  actionType: string;
  parameters: JsonValue;
  status: string;
  proposedAt: Date;
  decidedAt: Date | null;
  decidedById: string | null;
  executedAt: Date | null;
  resultEntityId: string | null;
  resultError: string | null;
  gitCommitHash: string | null;
  toolEvaluationId: string | null;
}

export interface NotificationBase {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  read: boolean;
  createdAt: Date;
}

export interface AuthorizationDecisionLogBase {
  id: string;
  decisionId: string;
  actorType: string;
  actorRef: string;
  humanContextRef: string | null;
  agentContextRef: string | null;
  delegationGrantId: string | null;
  authorityBindingId: string | null;
  actionKey: string;
  objectRef: string | null;
  decision: string;
  rationale: JsonValue;
  createdAt: Date;
  endpointUsed: string | null;
  mode: string | null;
  routeContext: string | null;
  sensitivityLevel: string | null;
  sensitivityOverride: boolean | null;
}

// ── Exported entities (base + the relations the server includes) ────────────

/** Portfolio with its products and epic links. */
export interface Portfolio extends PortfolioBase {
  products: DigitalProductBase[];
  epicPortfolios: EpicPortfolioBase[];
}

/** Epic with its portfolio links (each carrying the portfolio) and backlog items. */
export interface Epic extends EpicBase {
  portfolios: Array<EpicPortfolioBase & { portfolio: PortfolioBase }>;
  items: BacklogItemBase[];
}

/** Backlog item with its epic, product, and taxonomy node. */
export interface BacklogItem extends BacklogItemBase {
  epic: EpicBase | null;
  digitalProduct: DigitalProductBase | null;
  taxonomyNode: TaxonomyNodeBase | null;
}

/** Customer account with its contacts. */
export interface CustomerAccount extends CustomerAccountBase {
  contacts: CustomerContactBase[];
}

/** Agent conversation thread with its messages. */
export interface AgentThread extends AgentThreadBase {
  messages: AgentMessageBase[];
}

export type AgentMessage = AgentMessageBase;

export type AgentActionProposal = AgentActionProposalBase;

export type Notification = NotificationBase;

export type AuthorizationDecisionLog = AuthorizationDecisionLogBase;

export interface BookingConfig {
  durationMinutes: number;
  beforeBufferMinutes?: number;
  afterBufferMinutes?: number;
  minimumNoticeHours?: number;
  maxAdvanceDays?: number;
  slotIntervalMinutes?: number;
  schedulingPattern: "slot" | "class" | "recurring";
  assignmentMode: "next-available" | "customer-choice";
  capacity?: number;
  bookingLimits?: {
    day?: number;
    week?: number;
    month?: number;
  };
}
