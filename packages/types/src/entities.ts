import type { Prisma } from "@dpf/db";

export type Epic = Prisma.EpicGetPayload<{
  include: {
    portfolios: { include: { portfolio: true } };
    items: true;
  };
}>;

export type BacklogItem = Prisma.BacklogItemGetPayload<{
  include: { epic: true; digitalProduct: true; taxonomyNode: true };
}>;

export type Portfolio = Prisma.PortfolioGetPayload<{
  include: { products: true; epicPortfolios: true };
}>;

export type CustomerAccount = Prisma.CustomerAccountGetPayload<{
  include: { contacts: true };
}>;

export type AgentThread = Prisma.AgentThreadGetPayload<{
  include: { messages: true };
}>;

export type AgentMessage = Prisma.AgentMessageGetPayload<{}>;

export type AgentActionProposal = Prisma.AgentActionProposalGetPayload<{}>;

export type Notification = Prisma.NotificationGetPayload<{}>;

export type AuthorizationDecisionLog = Prisma.AuthorizationDecisionLogGetPayload<{}>;
