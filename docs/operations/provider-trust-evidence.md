# Provider trust evidence and route receipts

Use this runbook when a provider is configured but DPF reports that regulated or otherwise restricted work cannot use it.

## Authority boundaries

- `ModelProvider` owns the provider catalog and runtime lifecycle.
- `AiProviderConnection` owns the configured account/channel posture. A vendor may have several connections with different rights.
- `SupplierContract` owns the commercial agreement and its active dates.
- `ComplianceEvidence` owns reviewed claim evidence, validity, expiry, rejection, and supersession. Provider evidence is linked to exactly one connection.
- `RouteDecisionLog.suitabilityReceipt` owns the policy-safe routing receipt. It is not an evidence-document store.

Never infer a BAA, DPA, zero-retention term, regional entitlement, administrative control, SLA, or router endpoint approval from provider marketing or from another account for the same vendor.

## Review and remediation

1. Open **Platform → AI Operations → Providers & Routing** and select the configured provider.
2. Confirm the connected account type and execution channel are correct.
3. Review **Provider trust evidence**. The summary separates a saved account declaration from evidence needed only for sensitive or restricted work. It shows the number of restricted-work limitations plus every evaluated claim's status, age, expiry, consequence, and next action.
4. For missing evidence, obtain and review evidence for this exact account or tenant.
5. For expired evidence, renew or replace it. Do not extend the date without a current source.
6. For rejected evidence, resolve the review finding before enabling restricted work.
7. For conflicting evidence, determine which assertion is authoritative and supersede the obsolete revision.
8. For replaced evidence, link the current revision. The old revision remains in the audit trail and cannot authorize work.
9. Reassess the intended workload. Public marketing work and regulated records are separate decisions; a failed restricted-work claim should not be turned into a provider-wide guess.

Operator declarations made on the provider page are evidence-backed for 90 days, remain weaker than reviewed contract evidence, and never become a BAA, DPA, or enterprise entitlement by themselves.

The provider page can update declaration-backed claims such as enabled processing regions. It cannot capture a DPA or other reviewed supplier evidence. When that workflow is unavailable, the page says so directly and keeps restricted work blocked until platform governance links the current evidence; a generic provider-health alarm is not used for that condition.

## Receipt privacy check

A provider suitability route receipt may contain:

- receipt schema, compiler, policy, and work-context input versions;
- a one-way internal connection reference and bounded channel/account-class posture;
- selected provider and router-selected underlying provider identifiers;
- excluded provider identifiers, enforced obligations, and explanation codes;
- receipt creation time.

It must not contain prompts, messages, tool payloads, credentials, secrets, vendor account identifiers, raw organization or connection identifiers, uploaded evidence content, file references, or free-text explanations. Treat any such field as an audit defect and stop the affected rollout until corrected.

## Existing installs

The schema migration adds only nullable evidence and receipt fields. Existing connections remain unknown/unreviewed; the migration does not manufacture rights from old declarations. Continuous remediation and staged enforcement for existing installs is owned by BI-AIPS-008.
