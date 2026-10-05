-- BI-9BAAD504. No schema tightening. Keep execution aliases and every FK.
-- Only nonconflicting assertions retire automatically; never union grants.
-- The identity map is a migration-time snapshot of agent-identity.ts.
-- Audit each original key BEFORE deleting duplicates, in the migration transaction.
DO $$
DECLARE
  identities jsonb := '{"evaluate-orchestrator":"AGT-ORCH-100","explore-orchestrator":"AGT-ORCH-200","integrate-orchestrator":"AGT-ORCH-300","deploy-orchestrator":"AGT-ORCH-400","release-orchestrator":"AGT-ORCH-500","consume-orchestrator":"AGT-ORCH-600","operate-orchestrator":"AGT-ORCH-700","governance-orchestrator":"AGT-ORCH-800","finance-agent":"AGT-900","coo":"AGT-ORCH-000","build-specialist":"AGT-WS-BUILD","change-reviewer":"AGT-WS-REVIEW","admin-assistant":"AGT-WS-ADMIN","portfolio-advisor":"AGT-WS-PORTFOLIO","external-catalog-scout":"AGT-WS-SCOUT","inventory-specialist":"AGT-WS-INVENTORY","ea-architect":"AGT-WS-EA","hr-specialist":"AGT-WS-HR","time-off-advisor":"AGT-WS-TIME-OFF","customer-advisor":"AGT-WS-CUSTOMER","marketing-specialist":"AGT-WS-MARKETING","ops-coordinator":"AGT-WS-OPS","platform-engineer":"AGT-WS-PLATFORM","onboarding-coo":"AGT-WS-ONBOARD","ux-design-critic":"AGT-906","farm-ranch-steward":"AGT-WS-FARM-RANCH","compliance-officer":"AGT-WS-COMPLIANCE","data-architect":"AGT-WS-DATA-ARCHITECT","data-steward":"AGT-WS-DATA-STEWARD","dispatcher":"AGT-WS-DISPATCHER","mailroom-coordinator":"AGT-WS-MAILROOM","integration-engineer":"AGT-WS-INTEGRATION","legal-operations-counsel":"AGT-WS-LEGAL","security-engineer":"AGT-WS-SECURITY","storefront-advisor":"AGT-WS-STOREFRONT","finance-controller":"AGT-WS-FINANCE","market-research-analyst":"AGT-WS-MARKET-RESEARCH","doc-specialist":"AGT-WS-DOC","licensing-specialist":"AGT-905","ux-accessibility-agent":"AGT-903","soc-triage-analyst":"AGT-SOC-TRIAGE","soc-investigator":"AGT-SOC-INVESTIGATOR","soc-threat-hunter":"AGT-SOC-HUNTER","soc-incident-commander":"AGT-SOC-IR-LEAD","external-claude-code":"AGT-EXT-CLAUDE","external-codex":"AGT-EXT-CODEX","external-grok":"AGT-EXT-GROK","bookkeeper":"AGT-907"}'::jsonb;
  pair record;
  previous_id text;
  current_id text;
  key text;
  current_state text;
  previous_state text;
  conflicting boolean;
BEGIN
  FOR pair IN SELECT * FROM jsonb_each_text(identities) LOOP
    SELECT id INTO previous_id FROM "Agent" WHERE "agentId" = pair.key;
    SELECT id INTO current_id FROM "Agent" WHERE "agentId" = pair.value;
    IF previous_id IS NULL OR current_id IS NULL OR previous_id = current_id THEN CONTINUE; END IF;
    conflicting := false;
    FOR key IN
      SELECT "grantKey" FROM "AgentToolGrant" WHERE "agentId" = previous_id
      UNION SELECT "grantKey" FROM "AgentToolGrantRevocation" WHERE "agentId" = previous_id
    LOOP
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM "AgentToolGrantRevocation" WHERE "agentId" = current_id AND "grantKey" = key) THEN 'revoked'
        WHEN EXISTS (SELECT 1 FROM "AgentToolGrant" WHERE "agentId" = current_id AND "grantKey" = key) THEN 'granted'
        ELSE 'absent' END INTO current_state;
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM "AgentToolGrantRevocation" WHERE "agentId" = previous_id AND "grantKey" = key) THEN 'revoked'
        ELSE 'granted' END INTO previous_state;
      IF current_state <> previous_state AND NOT (current_state = 'absent' AND previous_state = 'revoked') THEN
        conflicting := true;
        EXIT;
      END IF;
    END LOOP;
    IF conflicting THEN CONTINUE; END IF;

    FOR key IN
      SELECT "grantKey" FROM "AgentToolGrant" WHERE "agentId" = previous_id
      UNION SELECT "grantKey" FROM "AgentToolGrantRevocation" WHERE "agentId" = previous_id
    LOOP
      INSERT INTO "ToolExecution" (id, "threadId", "agentId", "userId", "toolName", parameters, result,
        success, "executionMode", "auditClass", "routeContext", summary)
      VALUES ('authority-retirement-' || md5(previous_id || ':' || key),
        'coworker-permissions:' || pair.value, pair.value, 'system:migration:BI-9BAAD504',
        'migrate_coworker_permissions',
        jsonb_build_object('canonicalAgentId', pair.value, 'aliasAgentId', pair.key, 'grantKey', key, 'source', 'unchanged'),
        jsonb_build_object(
          'canonical', jsonb_build_object(
            'grant', (SELECT to_jsonb(g) FROM "AgentToolGrant" g WHERE g."agentId" = current_id AND g."grantKey" = key),
            'revocation', (SELECT to_jsonb(r) FROM "AgentToolGrantRevocation" r WHERE r."agentId" = current_id AND r."grantKey" = key)),
          'alias', jsonb_build_object(
            'grant', (SELECT to_jsonb(g) FROM "AgentToolGrant" g WHERE g."agentId" = previous_id AND g."grantKey" = key),
            'revocation', (SELECT to_jsonb(r) FROM "AgentToolGrantRevocation" r WHERE r."agentId" = previous_id AND r."grantKey" = key))),
        true, 'migration', 'authority-trail', '/platform/ai/agent/' || pair.value,
        'Safe duplicate permission authority retired; execution alias retained.');
    END LOOP;
    -- Move revocation-only assertions intact (id, actor and time preserved).
    UPDATE "AgentToolGrantRevocation" r SET "agentId" = current_id
      WHERE r."agentId" = previous_id
      AND NOT EXISTS (SELECT 1 FROM "AgentToolGrantRevocation" c WHERE c."agentId" = current_id AND c."grantKey" = r."grantKey");
    DELETE FROM "AgentToolGrant" WHERE "agentId" = previous_id;
    DELETE FROM "AgentToolGrantRevocation" WHERE "agentId" = previous_id;
  END LOOP;
END $$;
