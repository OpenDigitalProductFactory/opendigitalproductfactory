// Server-side contract drift guard.
//
// Asserts that each portable entity DTO in `@dpf/types` stays structurally
// compatible with the Prisma payload it mirrors. `@dpf/types` may no longer
// import Prisma — it is a portable contract shared with the mobile app and the
// API client (see docs/architecture/package-boundaries.md) — so this check
// lives here in the web app, which legitimately depends on both `@dpf/db` and
// `@dpf/types`.
//
// If the Prisma schema changes such that a payload no longer satisfies its DTO
// (a renamed, removed, or retyped column the wire contract still promises), one
// of the assertions below stops compiling and `pnpm --filter web typecheck`
// (and the production build) fails — surfacing the drift before it ships to a
// portable consumer.
//
// Two columns serialize differently from their in-memory Prisma type, so the
// `Wire<>` helper maps them to the shape the DTO promises:
//   * `Decimal`  -> `number`      (validators use `z.number()`)
//   * `Json`     -> contract `JsonValue` (the two recursive JSON types are
//                                   normalized so optional-member nuances in
//                                   Prisma's `JsonValue` do not cause a false
//                                   mismatch)
// `DateTime` is intentionally left as `Date` to match the DTOs exactly.

import type { Prisma } from "@dpf/db";
import type {
  AgentActionProposal,
  AgentMessage,
  AgentThread,
  AuthorizationDecisionLog,
  BacklogItem,
  CustomerAccount,
  Epic,
  Notification,
  Portfolio,
} from "@dpf/types";

// Map a single Prisma payload field to its over-the-wire form. Only `Decimal`
// diverges (Decimal -> number); JSON needs no mapping because the contract
// `JsonValue` is a structural supertype of Prisma's, and `Date` is carried
// as-is to match the DTOs.
type WireField<V> = [V] extends [Prisma.Decimal]
  ? number
  : [V] extends [Prisma.Decimal | null]
    ? number | null
    : V;

type Wire<T> = { [K in keyof T]: WireField<T[K]> };

// Compiles only if `Actual` is assignable to `Expected`; the constraint is the
// assertion. A drift makes the type argument violate the constraint and tsc
// reports it at the offending alias.
type AssertWireSatisfiesContract<Expected, _Actual extends Expected> = true;

type _Portfolio = AssertWireSatisfiesContract<
  Portfolio,
  Wire<Prisma.PortfolioGetPayload<{ include: { products: true; epicPortfolios: true } }>>
>;

type _Epic = AssertWireSatisfiesContract<
  Epic,
  Wire<Prisma.EpicGetPayload<{ include: { portfolios: { include: { portfolio: true } }; items: true } }>>
>;

type _BacklogItem = AssertWireSatisfiesContract<
  BacklogItem,
  Wire<Prisma.BacklogItemGetPayload<{ include: { epic: true; digitalProduct: true; taxonomyNode: true } }>>
>;

type _CustomerAccount = AssertWireSatisfiesContract<
  CustomerAccount,
  Wire<Prisma.CustomerAccountGetPayload<{ include: { contacts: true } }>>
>;

type _AgentThread = AssertWireSatisfiesContract<
  AgentThread,
  Wire<Prisma.AgentThreadGetPayload<{ include: { messages: true } }>>
>;

type _AgentMessage = AssertWireSatisfiesContract<AgentMessage, Wire<Prisma.AgentMessageGetPayload<object>>>;

type _AgentActionProposal = AssertWireSatisfiesContract<
  AgentActionProposal,
  Wire<Prisma.AgentActionProposalGetPayload<object>>
>;

type _Notification = AssertWireSatisfiesContract<Notification, Wire<Prisma.NotificationGetPayload<object>>>;

type _AuthorizationDecisionLog = AssertWireSatisfiesContract<
  AuthorizationDecisionLog,
  Wire<Prisma.AuthorizationDecisionLogGetPayload<object>>
>;

// Surface the checks as a single exported tuple so no `noUnusedLocals`-style
// setting can strip them and silently disable the guard.
export type EntityContractDriftChecks = [
  _Portfolio,
  _Epic,
  _BacklogItem,
  _CustomerAccount,
  _AgentThread,
  _AgentMessage,
  _AgentActionProposal,
  _Notification,
  _AuthorizationDecisionLog,
];
