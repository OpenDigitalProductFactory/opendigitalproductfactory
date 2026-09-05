---
status: active
---

# Security sweep credential: read all three alert surfaces

**Backlog item:** BI-3E6AFF04 · **Workflows:** `security-findings-watch.yml`, `audit-stale-overrides.yml` · **Standing report:** issue #4389

## Symptom

The daily sweep's report opens with "2 of 3 surfaces could not be read". Dependabot and Secret scanning alerts answer 403 because the workflow is running on the default `GITHUB_TOKEN`, which cannot read those two surfaces no matter what `permissions:` declares.

## Credential order (what the workflows try)

1. **GitHub App installation token**, minted per run by `actions/create-github-app-token` from the repository secrets `SECURITY_SWEEP_APP_ID` and `SECURITY_SWEEP_APP_PRIVATE_KEY`. Lives one hour. No renewal cliff. Preferred.
2. **Fine-grained PAT** in `DEPENDABOT_ALERTS_TOKEN`. Works with no code change but expires; record the owner and expiry.
3. `GITHUB_TOKEN`. Code scanning only; the report says the other two are unreadable.

## Operator step (once, by a repository admin)

This is the one step an agent cannot do: it needs the GitHub web UI under your own sign-in.

1. GitHub → the organization's Settings → Developer settings → GitHub Apps → New GitHub App. Name it `dpf-security-sweep`. Webhook: off.
2. Repository permissions: **Dependabot alerts: Read**, **Secret scanning alerts: Read**, **Code scanning alerts: Read**. Nothing else.
3. Create the App, note the **App ID**, then **Generate a private key** (a `.pem` download).
4. Install the App on the `opendigitalproductfactory` repository only.
5. Repository → Settings → Secrets and variables → Actions: add `SECURITY_SWEEP_APP_ID` (the number) and `SECURITY_SWEEP_APP_PRIVATE_KEY` (the whole `.pem` contents).

## Verify the sweep is complete

Run `security-findings-watch.yml` by hand (Actions → the workflow → Run workflow) and read issue #4389 after it finishes. The header must no longer say any surface could not be read, and the summary must list counts for all three surfaces. A green run with the "could not be read" header is still an incomplete sweep.

## Rollback

Delete the two secrets. The mint step is skipped and the workflows fall back to the PAT, then `GITHUB_TOKEN`.
