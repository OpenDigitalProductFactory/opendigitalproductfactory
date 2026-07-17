-- EP-31815F97 S2 (BI-F82F4E04): chain-of-custody link on ToolExecution.
-- Additive, nullable — joins a governed tool call to its agent→agent
-- DelegationChain (getChainOfCustody(chainId)); the human origin remains on
-- userId/delegatingUserId. Non-destructive.
ALTER TABLE "ToolExecution" ADD COLUMN "delegationChainId" TEXT;
CREATE INDEX "ToolExecution_delegationChainId_idx" ON "ToolExecution"("delegationChainId");
