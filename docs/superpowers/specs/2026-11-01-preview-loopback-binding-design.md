---
status: active
---

# Contributor preview loopback port binding

BI-4E94B021 / WC-A82F865E. Small defect repair of the existing preview controller.

## Problem and grounding

The metrics preview at 49a8927cf81c7e11b3eb8b63236c9a8b5d092f5d initialized and passed health/source/lease checks. Docker inspection showed 0.0.0.0:3001 for container port 3000. The canonical UX issuer correctly refused preview_issuer_binding_mismatch. The controller's JSON override sets no ports, so it inherits the install's DPF_HOST_BIND_ADDRESS. BI-10AC904B covers earlier source/startup binding; BI-6B109903 covers declaration isolation. Neither replaces inherited published ports. Reuse their existing controller, lease and strict identity fences.

## Contract and boundaries

**OBJ-PORT:** An otherwise valid governed preview can pass the existing loopback-only sign-in binding check, independent of the installation host bind setting.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-MERGE | OBJ-PORT | Real Docker Compose config merging replaces inherited dev-portal port mappings with exactly 127.0.0.1:3001:3000/tcp, including when the base publishes 0.0.0.0 and IPv6 wildcard bindings. |
| AC-FENCE | OBJ-PORT | Controller config and actual-container checks reject absent, broad, additional or wrong-port bindings before claiming a usable preview; the canonical sign-in issuer remains unchanged. |
| AC-SCOPE | OBJ-PORT | Other services, installed Compose files and installation environment remain unchanged; existing mount, lease, SHA, declaration and source-cleanliness checks continue to apply. |

This changes only ephemeral preview configuration and its validation. No schema, grants, credentials, provider spend, installation policy or production change. Metrics owns prior preview cleanup; this delivery launches no duplicate controller or upgrade. Tests use disposable configuration fixtures and docker compose config only, without starting services.

## Research and compatibility

Docker's official merge specification (https://docs.docker.com/reference/compose-file/merge/) identifies ports by IP, target, published and protocol: merely appending a loopback mapping can retain the broad mapping. Adopt the standard !override tag, supported by Compose >=2.24.4, rather than weakening the issuer or changing the installation's host setting. Local observed Compose is 5.6.1. No new dependency or alternative runtime is needed. Unsupported Compose fails parsing before runtime mutation; do not fall back to broader binding. This is an implementation defect repair, not a new feature requiring product comparisons.

The controller already generates a private ephemeral file. Preserve previewOverride's existing object contract and serialize its service values as JSON-compatible YAML, with a tagged ports replacement for dev-portal. JSON stringification safely quotes dynamic paths/values; the only YAML-specific syntax is the fixed tag. Change the private extension to .yaml. Keep one override file and normal cleanup.

## Ordered implementation and verification plan

1. Add a real Compose merge regression against a disposable base with broad IPv4 and IPv6 preview bindings and an unrelated service. Initially exercise today's generated JSON representation and observe the broad mappings remain. Record the failing result.
2. Add the tagged YAML serialization seam used by the actual controller. Preserve init and portal object contents, replace only portal ports, and retain canonical issuer behavior.
3. Add rendered config and actual Docker binding validation, with rejection cases for missing/broad/mixed/wrong-port mappings. Run affected preview/declaration/lifecycle and issuer tests; preserve existing fixtures by supplying valid port identities where appropriate.
4. Run source guards, canonical shared integration and independent semantic review on the exact committed source. Publish a DCO PR through the protected queue. Hand the qualified controller identity to the canonical publisher and metrics owner; live sign-in remains unverified until their governed runtime exercise.

These steps deliver one indivisible port-binding repair; tests or serialization alone do not ship independently. No data migration or rollback action: revert the source change through normal publication if necessary, preserving strict issuer refusal.
