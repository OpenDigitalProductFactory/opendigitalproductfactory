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

export type CustomerAccountWithRoles = Prisma.CustomerAccountGetPayload<{
  include: {
    contacts: true;
    contactRoles: { include: { contact: true } };
  };
}>;

export type ContactAccountRole = Prisma.ContactAccountRoleGetPayload<{
  include: { contact: true; account: true };
}>;

export type Engagement = Prisma.EngagementGetPayload<{
  include: {
    contact: true;
    account: true;
    assignedTo: { select: { id: true; email: true } };
  };
}>;

export type Opportunity = Prisma.OpportunityGetPayload<{
  include: {
    account: true;
    contact: true;
    assignedTo: { select: { id: true; email: true } };
    activities: true;
  };
}>;

export type Activity = Prisma.ActivityGetPayload<{
  include: {
    account: { select: { id: true; accountId: true; name: true } };
    contact: { select: { id: true; email: true; firstName: true; lastName: true } };
    opportunity: { select: { id: true; opportunityId: true; title: true } };
    createdBy: { select: { id: true; email: true } };
  };
}>;

export type AgentThread = Prisma.AgentThreadGetPayload<{
  include: { messages: true };
}>;

export type AgentMessage = Prisma.AgentMessageGetPayload<{}>;

export type AgentActionProposal = Prisma.AgentActionProposalGetPayload<{}>;

export type Notification = Prisma.NotificationGetPayload<{}>;

export type AuthorizationDecisionLog = Prisma.AuthorizationDecisionLogGetPayload<{}>;

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
