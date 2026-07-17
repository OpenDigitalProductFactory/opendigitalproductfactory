# OSS Repo Identity Hygiene

This repository is public. Customer, operator, and individual-person identity —
real company names, customer names, people's names, private hostnames or IP
addresses — must **not** be committed here. Real identity belongs in an install's
private configuration and onboarding data, never in source.

This applies no matter which surface produced the change: an interactive Claude
or Codex session, a Build Studio build, a scheduled agent, or a human working
tree. The enforcement point is chosen so all of them are covered.

## What is and isn't allowed

- **Not allowed:** a customer/operator legal entity used as a "Customer 0" or
  install identity; a customer's name, a contact's name, a private email, a
  private hostname or IP, an account number.
- **Allowed (audited):** an identity that is *already public and operationally
  required* — for example the App Store / Play Store **publisher legal entity**,
  which the stores display and a privacy policy must name. These live in a small,
  audited set of files (the mobile store runbook, the mobile privacy-policy
  draft, the generated business-type pages, and the generated docs index).
- **Fine anywhere:** genericized, archetype-level language — "the Customer 0
  organization", "the operator", "the publishing entity", "your install".

When you need the essence of something customer-specific in the repo, keep the
**generic, reusable archetype** shape and move the identity to the install's
private config. See
[Customer 0 Pre-Install Readiness](customer-zero-preinstall-readiness.md) for a
worked example of a doc written this way.

## How it is enforced

Two scanners run on every PR; they cover different risks and have different
teeth:

| Scanner | Catches | Runs at | Blocks merge? |
| --- | --- | --- | --- |
| gitleaks (`secrets-scan.yml`) | secret-**shaped** content — keys, tokens, credentials | pre-commit + CI | No — advisory only |
| **check-no-private-identity** (Repo Guard Loop) | protected-identity **names/tokens** | CI (required) | **Yes** |

An organization *name* is not secret-shaped, so gitleaks does not catch it — that
is the gap that let a real customer identity into a docs PR once. Because the
Secrets Scan is not a required status check, it also cannot stop a merge on its
own. The identity ratchet therefore lives in the **Repo Guard Loop**, which *is*
a required check and runs on every PR regardless of author — the only
surface-agnostic chokepoint that actually blocks the merge.

### The ratchet

[`scripts/check-no-private-identity.mjs`](../../scripts/check-no-private-identity.mjs)
freezes a per-file **count baseline**
([`scripts/private-identity-baseline.txt`](../../scripts/private-identity-baseline.txt))
of the protected tokens in
[`scripts/private-identity-tokens.txt`](../../scripts/private-identity-tokens.txt).
Each file may only **shrink**. A new file, or more occurrences in a listed file,
fails CI. The baseline is the audited allowlist: it records exactly the
legitimate references that exist today and blocks any new spread.

## When the guard fails on your PR

1. **You added a real identity that shouldn't be here.** Genericize it —
   replace the name with archetype-level language and move the real value to the
   install's private config. Re-run `node scripts/check-no-private-identity.mjs`.
2. **You legitimately edited an audited file** (e.g. added a line to the mobile
   store runbook that mentions the public publisher). Run
   `node scripts/check-no-private-identity.mjs --update`, review the one-line
   baseline change, and **call it out in your PR description** so a reviewer
   confirms the new reference is genuinely public/required.

## Protecting a new entity

When a new customer or partner needs protecting:

1. Add its token to
   [`scripts/private-identity-tokens.txt`](../../scripts/private-identity-tokens.txt).
2. Run `node scripts/check-no-private-identity.mjs --update` to snapshot the
   current (audited) occurrences as the new baseline.
3. Review the baseline diff — every frozen occurrence must be a legitimate,
   already-public reference. If any is a real leak, genericize it first, then
   re-update.

> **Do not paste a genuinely-secret value into the tokens file.** The denylist is
> committed, so a secret listed there is itself leaked into history. The tokens
> file is only for names that are already public (like a published app entity).
> Keep truly-private values out of the repo entirely.

## Known limits (defense-in-depth, not a wall)

- The ratchet is a **name denylist**: it catches *known* protected tokens, not an
  arbitrary unseen customer name. It is the backstop for the class we know about;
  the reviewer is still the first line for a brand-new name.
- Per-file **path granularity**: a legitimate audited file is trusted as a whole,
  so identity added *inside* an already-audited file is only caught as a count
  increase, not by meaning.
- Generic PII heuristics (real-domain emails, IPs) are intentionally **not** wired
  in yet — the repo carries many synthetic test personas that would make a pure
  heuristic noisy. A curated heuristic pass is a possible future enhancement.
