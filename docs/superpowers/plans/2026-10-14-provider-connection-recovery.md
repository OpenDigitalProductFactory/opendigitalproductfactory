---
status: active
---
# Provider connection recovery — BI-2DD2AF13

## Problem and scope

The Codex provider form showed a saved OAuth token as Connected while verification failed. During a self-upgrade, its mutation POST is refused with 503 and the server-action catch reduces this to Setup failed. Retry. A dated token also hides the reconnect action even when upstream has rejected it.

## Design grounding

Extend the existing provider detail route, ProviderDetailForm, OAuthConnectionStatus, startProviderOAuth and UpgradeHold probeQuiescence. The existing quiescence read is the pause truth; the actual Responses probe is access truth; credential status and expiry are stored authentication metadata. Follow the background-operation observation contract and theme-aware styling runbook. No schema, permission or account-activation change.

## Delivery plan

1. Add regression tests for an upgrade refusal and reconnect before token expiry.
2. Probe quiescence only after a caught setup exception. Explain a live upgrade; otherwise offer reload without exposing server details.
3. Label saved authentication honestly. Expose Sign in again without disconnecting first; put Disconnect under Account actions and respect write permission.
4. Update the provider guide and carry the recorded UX option decision.
5. Run affected tests, package typecheck, exact-tree pregate, semantic review and protected PR checks. Deploy through canonical self-upgrade and validate the served UI if connector authority permits.

## Evidence and limitations

Browser reproduced the generic message on the live provider route; MCP confirmed upgrade draining. Runtime logs separately showed upstream 401 and failed token refresh. Local regression tests initially failed and then passed (16 tests). Production connection test is awaiting envelope cmv7ne20q1t3101mxi30wx33e; request_self_upgrade discovery reported agent-grant-missing for admin_write. These restrictions are preserved. Credential entry remains operator-only.

Prototype: /tmp/dpf-provider-recovery-prototype.html, created before implementation. Browser file-URL policy blocked rendering; no workaround was used. Advisory UX critique engagement CE-B325E978 was requested using the dpf-ux-fit-review skill. Option decision DI-55FE7792E84B chose contextual-reconnect.
