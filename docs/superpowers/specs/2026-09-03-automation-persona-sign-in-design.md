---
status: binding
---

# Automation Persona Sign-In: the platform signs its own browser in

| Field | Value |
| --- | --- |
| Date | 2026-09-03 |
| Backlog | BI-9369DEB5 (EP-ZERO-CONFIG-FEDERATION) |
| Surface | Auth.js session issuance, MCP `ux-verification` pack, `/api/automation/sign-in` |
| Owners | Identity, delivery surfaces |

## 1. Decision

An installation that is operated by agents alone must let those agents verify
its pages in a real browser: layout, type, colour, overrun and empty states
cannot be judged any other way. Most pages are session-gated. The platform
therefore signs **its own** browser in, as a seeded automation persona, through
a one-time link it mints for itself. No person is asked to sign in, no password
is typed by an agent, and no credential passes through an agent prompt.

Founder ruling, 2026-09-03, on the development install nobody but agents
touches: "I need you to log in and test the UX, not ever bypass" and "it
defeats 99% of the need for you if you can't test in my complete absence."

## 2. Research and benchmarking

| System | Pattern | DPF decision |
| --- | --- | --- |
| [Playwright `storageState`](https://playwright.dev/docs/auth) | Tests sign in once through the real UI and reuse the saved session. | Adopt the shape (a real session, reused), reject the mechanism: it still needs a credential the automation can type. |
| [Auth.js magic links](https://authjs.dev/getting-started/authentication/email) | A signed, expiring, single-use link establishes a session without a password. | Adopt: the link is minted server-side for the persona and exchanged for the same JWT cookie Auth.js issues. |
| [Kubernetes service accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) | Automation acts under its own identity with its own audit trail, never a human's. | Adopt: a dedicated persona (`automation@dpf.local`) with its own Principal and EmployeeProfile. |

Rejected: reusing the seeded operator account (audit would blame a person);
a test-mode auth bypass header (a bypass by construction); typing the install's
admin password from a file (a credential handled in plain text by an agent).

## 3. Contract

- **Persona.** `automation@dpf.local`, display name "Platform automation",
  created on first use with a random unusable password, `HR-000` group,
  Principal via `syncUserPrincipal`, an active EmployeeProfile. Idempotent.
- **Permission.** Allowed when the resolved environment class is `development`
  or `test`. Any other class refuses unless PlatformConfig
  `automation.signIn.enabled` is `{ "enabled": true }`, recorded by an operator.
  Checked at mint AND at exchange.
- **Link.** `GET /api/automation/sign-in?token=<jwt>`; the token is HS256 over
  `AUTH_SECRET`, purpose `dpf.automation-sign-in/1`, subject = persona user id,
  `jti`, ten-minute expiry, `next` = same-origin landing path. Consumed once:
  the `jti` is recorded in PlatformConfig `automation.signIn.consumed`, pruned
  by expiry.
- **Session.** The route re-runs `authorizePrincipalForSession`, then issues the
  Auth.js JWT cookie (same name, secure flag and encoding salt as the
  configured sign-in) for two hours and redirects to `next`.
- **Tool.** `issue_ux_verification_sign_in` (pack `ux-verification`),
  capability `manage_platform`, grant `sandbox_execute` so an existing
  development token can call it. Returns the link, expiry and persona.
- **Audit.** Mint and exchange are logged with the requesting agent tag; every
  action in the session is the persona's.

## 4. Acceptance

1. On a development-class installation, an agent holding a development token
   calls the tool, opens the link in the browser it drives, and lands on the
   requested page signed in as the persona.
2. The same link opened twice is refused the second time; a link older than
   ten minutes is refused; a tampered link is refused.
3. On a production-class installation the tool refuses unless the operator
   grant is recorded.
