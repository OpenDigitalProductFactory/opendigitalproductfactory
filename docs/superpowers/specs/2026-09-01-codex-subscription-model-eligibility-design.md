---
status: active
---

# Codex subscription model eligibility — BI-37719AAB

This file is the complete approval artifact. Review it from the immutable blob;
the broader CLI routing spec §13 is supporting detail.

## Problem and evidence

At pre-fix ref `e7f618eae0b7481f37101654826cc8aad2a4a2d2`, the Codex adapter treated any
stderr containing `rate` as capacity and the endpoint loader admitted every
configured provider/model pair. A healthy ChatGPT-authenticated Codex login
returned HTTP 400 for `gpt-5.3-codex`; the phrase `degrade performance` was
misclassified as a 60-second rate limit. The same credential immediately
succeeded with `gpt-5.4`. This rules out expired authentication, real 429
capacity exhaustion, provider outage, and catalog-wide invalidity. The
test-first proof was 10 failed/88 passed before the fix; focused and
graph-expanded suites then passed 127/127 and 323/323. Exact-tree SHA
`18e443bbb2a90045037d8c944b7713d1bed0cfbd`, merged with current `main`, passed
all tests and the production build as evidence `cmti58h4g2sft01lhjtcc0x49`.

## Decision and boundaries

Account compatibility is a hard rule at the existing endpoint-manifest
boundary. For `(codex, oauth2_authorization_code, gpt-5.3-codex)`, the loader
sets `eligibilityExclusionReason`; routing retains the candidate in its trace
but excludes it before scoring or dispatch. OAuth `gpt-5.4`, Codex API-key
models, and other providers are unchanged. The adapter records capacity only
for explicit 429, Too Many Requests, rate-limit, quota-limit, weekly-limit, or
usage-limit signatures. Runtime Health maps the exclusion to
`account-model-eligibility` with model-assignment remediation.

The change composes the existing manifest, hard filter, trace, pool-status, and
exclusion-bucket contracts. It adds no schema, seed mutation, credential access,
auth weakening, second router, or new UI. Selection and classification are
atomic because either repair alone leaves the live incident reproducible.

## Alternatives, risk, rollback, and acceptance

Deleting the model globally would break valid API-key use. Silently dropping it
in the loader would make routing previews and Runtime Health lie. Broad prose
matching would repeat the false-capacity defect. Falling directly to local would
lower quality despite a supported sibling.

The compatibility rule is limited to the proven provider/auth/model tuple.
Executable guards cover the exact stderr, genuine 429 and subscription limits,
both auth modes, supported fallback routing, and operator attribution. Rollback
is one PR revert; no migration or data repair is required. Acceptance is:

- unsupported ChatGPT OAuth dispatch never occurs;
- `degrade performance` never mutates capacity;
- genuine 429 still records exhaustion;
- `gpt-5.4` wins without a local detour; and
- Runtime Health names the rejected model and corrective action.
