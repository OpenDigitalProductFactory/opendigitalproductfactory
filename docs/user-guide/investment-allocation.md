# Investment allocation

Open **Delivery Flow → Portfolio budgets → Investment balance** to review the work you fund. Installation settings links to the same editor.

Founder-funded shared platform work starts with an approximate target of **80% repair and refactoring, 20% new capability**. Organization and archetype work starts with **20% repair, 80% new capability**. These targets apply over time; they are not quotas for each task. Bug fixes normally count as repair.

The allocation belongs to a recorded budget owner, organization and work purpose. Development versus production, administrator access, the coding agent and the room coordinator do not choose the budget. One person can fund different kinds of work under different policies.

Use **Adjust allocation** to choose a priority, review window and reason. Automatic preference is optional. It prefers underfunded work only when recent measured coverage is sufficient, within the same funding scope and existing priority tiers. Both usage coverage and work classification must meet the policy coverage threshold; missing attempts never become zero-token work. Readiness, emergency obligations, spending limits and work-in-progress limits still apply.

Use **Installation funding** to explicitly apply your scope to matching unbound work on this install. Room funding takes precedence, followed by the nearest applicable parent room, then portfolio and installation funding. Different items in a common room can retain different owners. Another installation needs its own governed binding, including a paired production installation; copying settings does not grant funding authority.

The observed balance counts platform-recorded inference attempts, including retries. Unclassified work and missing usage stay visible. External agent inference outside the platform is unobserved. A fresh install says **Not measured yet**, rather than showing invented spending. Changing a policy or owner does not rewrite historical attribution.

Build Studio receives the resolved direction before inference. External agents receive it when claiming or reading a Workroom. The tools `get_investment_balance`, `set_investment_balance` and `bind_investment_funding` use the same owner checks as the portal. Read the current revision before changing it; a stale revision is refused.

WWMD steers platform architecture, WWWD the organization's business direction, and WSID professional practice. Those decisions inform the work; they do not transfer another owner's spending authority.

For documentation, tools, skills or other ambiguous work, the owner can supply `classification: refactor` or `new` when binding a specific Workroom item, with evidence in the reason. This leaves its work type intact. Omit classification to preserve an existing choice; use null to return to work-type classification. The recorded choice is captured before each attempt, so later corrections do not recategorize historical spending.

A funding owner can underwrite its organization's work in a portfolio managed by someone else. Portfolio management alone does not grant access to the owner's allocation. A change in the recorded portfolio manager requires explicit funding reaffirmation.

An expired allocation remains visible to its owner for renewal but cannot steer or fund new execution. When recorded ownership changes, the new owner can explicitly bind a successor scope. Disabling an account alone does not transfer its funding. A cloned room also requires an explicit binding on its new installation.
