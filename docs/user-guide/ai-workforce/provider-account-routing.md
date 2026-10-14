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

## Capacity and recovery

Authentication or billing trouble on one account stays with that account. A
provider-wide outage or an upstream quota shared by several accounts can restrict
all affected accounts. Separate sign-ins do not prove separate quota allowances.
DPF treats uncertain shared quota conservatively.

Within equally suitable accounts, routing can prefer an available account and
keep related work on the account that succeeded previously. This preference
cannot override Allowed work, model access or an account exclusion.

If credentials or account permissions change while a request is waiting, DPF
checks the current account before dispatch. A native execution whose outcome is
uncertain needs reconciliation before another attempt; it is not automatically
replayed on a sibling account.

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

The [delivery plan](../../superpowers/plans/2026-10-14-provider-account-capacity-refactor.md)
records qualification and acceptance. This guide describes the account-aware
contract; it does not claim that an installation has received the release.
