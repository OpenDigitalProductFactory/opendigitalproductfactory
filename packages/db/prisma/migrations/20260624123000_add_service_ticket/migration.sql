-- EP-MSP-FEDERATION · A3 (BI-99FEA7FA) — customer service desk. One canonical
-- ServiceTicket discriminated by ticketKind (incident|request|change|
-- scheduled-review); distinct from the internal PlatformIssueReport. Routed by
-- the A1 estate-scope columns; born from A2 correlated incidents.
CREATE TABLE "ServiceTicket" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketKind" TEXT NOT NULL DEFAULT 'incident',
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "severity" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "customerAccountId" TEXT,
    "customerSiteId" TEXT,
    "scopeKey" TEXT,
    "configurationItemId" TEXT,
    "serviceAgreementId" TEXT,
    "edgeNodeId" TEXT,
    "correlatedIncidentKey" TEXT,
    "slaPolicy" JSONB,
    "slaDueAt" TIMESTAMP(3),
    "ownerPrincipalId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceTicket_ticketId_key" ON "ServiceTicket"("ticketId");
CREATE INDEX "ServiceTicket_ticketKind_idx" ON "ServiceTicket"("ticketKind");
CREATE INDEX "ServiceTicket_status_idx" ON "ServiceTicket"("status");
CREATE INDEX "ServiceTicket_priority_idx" ON "ServiceTicket"("priority");
CREATE INDEX "ServiceTicket_customerAccountId_idx" ON "ServiceTicket"("customerAccountId");
CREATE INDEX "ServiceTicket_customerSiteId_idx" ON "ServiceTicket"("customerSiteId");
CREATE INDEX "ServiceTicket_scopeKey_idx" ON "ServiceTicket"("scopeKey");
CREATE INDEX "ServiceTicket_correlatedIncidentKey_idx" ON "ServiceTicket"("correlatedIncidentKey");
CREATE INDEX "ServiceTicket_slaDueAt_idx" ON "ServiceTicket"("slaDueAt");

CREATE TABLE "ServiceTicketComment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorPrincipalId" TEXT,
    "authorKind" TEXT NOT NULL DEFAULT 'operator',
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceTicketComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceTicketComment_ticketId_idx" ON "ServiceTicketComment"("ticketId");

ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_customerSiteId_fkey" FOREIGN KEY ("customerSiteId") REFERENCES "CustomerSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceTicketComment" ADD CONSTRAINT "ServiceTicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ServiceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
