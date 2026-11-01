---
title: "Routing with provider accounts"
area: ai-workforce
order: 4
---

## Choose accounts for the work

Each account has its own sign-in, model access and Allowed work review. Adding an
account does not give it the permissions or models of another account. Routing
first checks the work's sensitivity, location and model requirements, then
considers the available accounts. A disabled account remains excluded.

Model discovery records access for the selected account. A vendor catalog entry
alone does not prove that an account can run that model. Unknown capability and
quota information remain unknown until the provider supplies evidence.

## Read the account list

The provider list shows status and its reason without opening an account:

- **Working:** a request on this account succeeded within the last hour.
- **Enabled:** configured and enabled, with no recent successful check.
- **Waiting for capacity** or **Paused:** a usage limit, host reservation or pause prevents new work.
- **Needs attention:** review the account connection, model access or billing.
- **Status unconfirmed:** current routing information could not be read.

Check times and the next action appear alongside the status. A provider reset
estimate is different from a scheduled availability check. **Allowed work** says
which data may be sent; approval for company work does not mean the account is
available now. A successful request on another account is not proof for this one.

## Capacity and recovery

Authentication or billing trouble on one account stays with that account. A
provider-wide outage or an upstream quota shared by several accounts can restrict
all affected accounts. Separate sign-ins do not prove separate quota allowances.
DPF treats uncertain shared quota conservatively.

On **Providers & Routing**, open an account's **Limits and recovery** to see
when its limit was observed, the expected reset and the next recorded check.
A long-term reset is a forecast: the provider may make capacity available sooner.
Short waits supplied by the provider still apply.

For an active install-owned ChatGPT or Codex subscription account, **Check now**
sends one short synthetic request to the model you select. It never retries the
original coworker task. A completed check qualifies only that model, account,
credential and Responses endpoint for a limited time. Other models, coding-tool
limits, Allowed work and hard sign-in or billing restrictions remain separate.
An unsupported account-level quota record must be reconciled before a check;
DPF leaves that record intact.

Select **Recheck hourly while limited** when checking to commission bounded
future checks. Viewing the page does not opt an account in. **Stop hourly checks**
withdraws that existing commission without sending a provider request, including
when the account is paused or needs sign-in. Pausing, disabling or disconnecting
an account also prevents a new check; it does not reset the provider's allowance.

**View provider usage and resets** opens the provider's own usage page. When the
provider does not report reset offers to DPF, their availability and expiry stay
unknown. Viewing usage or checking capacity neither redeems a reset nor buys
credits. Review any offer and its terms with the provider before choosing it.

Within equally suitable accounts, routing can prefer an available account and
keep related work on the account that succeeded previously. This preference
cannot override Allowed work, model access or an account exclusion.

If credentials or account permissions change while a request is waiting, DPF
checks the current account before dispatch. A native execution whose outcome is
uncertain needs reconciliation before another attempt; it is not automatically
replayed on a sibling account.

**Model measurements.**

A successful capacity check shows that an account can answer a short request.
It does not measure the model's quality or lower a coworker's requirements.

For an active install-owned ChatGPT account with a fresh check for the selected
model, an administrator can request that model's evaluation. DPF first checks
whether the account's Responses endpoint honors the required output bound, then
runs the existing supported tests within one limited commission. Subscription
accounts cannot be included in a bulk evaluation.

The request acknowledgement means the evaluation was queued. Open **Test Runs**
for its actual outcome and summary. Only when all six supported grading dimensions
finish conclusively may their measurements update. The unavailable conversational grader stays
unverified; a partial evaluation does not raise whole-model confidence or the
evaluation count, and administrator overrides remain intact.

An incomplete response does not earn a score. A known incomplete outcome can
settle without measurements. When a provider attempt's outcome is unknown, DPF
retains its recorded attempt and requires reconciliation before another
commission; waiting longer or redelivering the job does not start a replacement.
Account, credential, model and operator changes are checked again before sending
a request and before saving measurements.

## Usage records

New routed observations record the account actually used and the quota scope
known at execution. Earlier usage remains unattributed. Removing an account does
not rewrite its usage history, and the provider's shared spend remains separate
from account attribution.

The documented Z.ai coding shared-key default keeps its legacy provider route
until an owned coding key is configured. It does not invent an independent
account credential or attribute old shared-key usage to another account. An
account denylist still blocks that default, and additional accounts never borrow
the shared key. Local's default continues to report shared host capacity without
requiring a credential.

This guide describes the account-aware routing contract. An installation's
release status determines whether these routing changes are available there.
