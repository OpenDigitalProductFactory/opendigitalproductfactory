---
title: "Sensitive-Data Policy Packs"
area: "ai-workforce"
order: 4
relatedCode:
  - apps/web/lib/inference/data-screening/vertical-policy-packs.ts
  - apps/web/lib/inference/data-screening/evaluate-inference-policy.ts
  - apps/web/lib/routing/provider-suitability/workload-profile.ts
---

## What the packs do

Before an AI request leaves the installation, DPF classifies the actual prompt,
messages, tool-call values, and governed-data hints. A sensitive-data policy
pack then gives the shared data-policy engine a conservative boundary for each
class it found.

The packs cover:

- customer and employee records;
- financial and clinical information;
- student and youth-sensitive information;
- legal privilege and criminal-justice information;
- safety cases, public-sector records, and security logs;
- regulated decisions;
- source code and credentials; and
- governed data whose classification is not yet known.

The installed business archetype helps DPF explain which packs are likely to
matter. It does not weaken a boundary. Clinical information receives the
clinical boundary even when it appears in a legal, home-service, or other
workflow.

## What counts as sensitive detail, and what does not

DPF looks for sensitive detail in what a coworker is actually being sent: your
messages, the results of the tools it runs, page data, attachments, recalled
knowledge and the coworker's own memory of prior work.

It does **not** treat a coworker's job description as sensitive detail. A COO's
description says it approves payroll runs; a finance controller's mentions
invoices; an HR director's mentions salaries. Those words describe the job, not
a person's pay. Treating them as sensitive detail used to confine those
coworkers to the on-box model permanently, which left them slower and less
capable at the work they were hired for, with no gain in protection — no salary
was ever in the request.

The distinction is drawn where the prompt is put together, so it is decided by
the part of DPF that knows which text is the coworker's brief and which is your
business's data. Anything DPF is not certain is a brief counts as your data. A
real salary, invoice number or bank detail is treated as sensitive detail
wherever it appears — including in a briefing DPF assembled for the coworker.

## Possible outcomes

DPF combines all detected packs and uses the strongest outcome:

- **Use after protection** — replaceable identifiers can be masked or tokenized.
  The protected payload may use an approved cloud connection after its account,
  contract, retention, training, region, and sector evidence passes provider
  review.
- **Human review required** — DPF keeps the work local/private until an
  accountable person confirms the purpose, role, and next action.
- **Do not send externally** — credentials, criminal-justice information, and
  unknown governed data stay inside the governed boundary. Remove or classify
  the sensitive detail before routing again.

A cheaper model, preferred provider, provider pin, retry, or fallback cannot
override these outcomes. Provider suitability can narrow the result further; it
cannot add a provider that the data policy removed.

## Initial boundaries

| Work contains | Default boundary | What must be true before broader use |
| --- | --- | --- |
| Customer records | protect, then approved cloud | purpose, retention, no-training, and contract evidence |
| Employee/HR records | protect, then approved cloud | authorized workforce role and account controls |
| Financial records | protect, then approved cloud | financial-customer safeguards and provider evidence |
| Clinical/health records | protect, then approved cloud | health-data contract and processing evidence |
| Student records | protect, then approved cloud | authorized school purpose and student-data terms |
| Youth-sensitive details | human review | verified guardian or authorized role and purpose |
| Legal privileged material | human review | authorized legal role and reviewed confidentiality terms |
| Criminal-justice information | do not send externally | a separately governed CJIS boundary |
| Safety-sensitive cases | human review | an accountable human checkpoint |
| Public-sector records | human review | authorized agency purpose and region |
| Security logs | protect, then approved cloud | security-purpose and provider-control evidence |
| Regulated decisions | human review | a named human decision owner and decision evidence |
| Source code | protect, then approved cloud | repository authority, no-training, and retention evidence |
| Credentials or secrets | do not send externally | omit and rotate the credential |
| Unknown governed data | do not send externally | classify the data first |

“Approved cloud” does not mean compliant or certified. It means the technical
data boundary allows provider review to continue. The final decision still
depends on current law, jurisdiction, activity, contracts, purpose,
authorization, and the exact connected account.

## Masking and correctness

Masking is used only when the exact value is replaceable for the task. DPF may
omit, redact, partially reveal, tokenize, or aggregate a value. If masking would
make the answer misleading—for example, when the exact account, clinical fact,
legal text, or safety detail is material—the task stays on an eligible
local/private route or stops for review.

Routing receipts keep hashes, class names, pack/policy versions, effects,
obligations, and explanation codes. They do not store prompts, detected values,
credentials, token maps, customer details, or employee details.

## Retention prompts

The packs provide retention prompt codes, not universal retention periods.
Retention varies by jurisdiction, record type, legal hold, purpose, and
organization policy. Follow the Data workspace and the applicable records
schedule; never infer a period from the presence of a policy pack alone.

## Standards and qualified review

The technical defaults are informed by authoritative guidance including the
[HHS HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html),
[FTC Safeguards Rule](https://www.ftc.gov/legal-library/browse/rules/safeguards-rule),
[FBI CJIS Security Policy resources](https://www.fbi.gov/services/cjis),
[U.S. Department of Education FERPA guidance](https://studentprivacy.ed.gov/ferpa),
[FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions),
[EEOC confidentiality guidance](https://www.eeoc.gov/laws/guidance/ada-primer-small-business),
[ABA Model Rule 1.6](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_6_confidentiality_of_information/),
and the [NIST AI Risk Management Framework](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10).

These links explain the source of the conservative defaults. They are not a
substitute for qualified legal, privacy, security, records, or regulatory review.

