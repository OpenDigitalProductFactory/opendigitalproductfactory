# CodeQL Advanced Setup + Sanitiser Model Pack

This directory holds the **advanced-setup** CodeQL configuration plus a custom
**data-extensions model pack** (`.github/codeql/dpf-sanitizers/`) that teaches
CodeQL about DPF's security helpers.

## Why we need this

DPF's security helpers — `assertSafeOutboundUrl`, `assertAllowedBinary`,
`assertAllowedPublicUrl` — are correct sanitisers. They validate scheme,
private-network membership, binary allowlists, and so on. But CodeQL's
default ruleset doesn't know about them by name, so every caller looks
like a tainted-flow vulnerability.

That generated ~4 critical and 1 high false-positive alerts during the
2026-05-22 security burn-down. The session closed every real defect; the
remaining open alerts are all false positives caused by this gap.

The model pack closes the gap. Each entry tells CodeQL "this function takes
a tainted value and returns a sanitised one" or "this return is neutral."

## What's here

| File | Purpose |
|---|---|
| `.github/workflows/codeql.yml` | Advanced-setup workflow (replaces GitHub's default-setup) |
| `.github/codeql/codeql-config.yml` | Top-level config; references the model pack |
| `.github/codeql/dpf-sanitizers/qlpack.yml` | Model pack manifest |
| `.github/codeql/dpf-sanitizers/dpf-sanitizers.model.yml` | Sanitiser declarations |

## Activation (one-time)

The workflow is committed but **inert** until default setup is disabled:

1. Go to **Settings → Code security** in the GitHub repo UI.
2. Find **CodeQL analysis** under "Code scanning."
3. Click **Set up** (or the gear icon) → choose **Advanced**.
4. Default setup auto-disables; this workflow becomes the source of truth.

After the toggle:
- Next push to any branch triggers `codeql.yml`.
- The model pack loads; sanitiser declarations take effect.
- The 4–5 remaining false-positive alerts should resolve on the next scan.

## Adding new sanitisers

When you add a new security helper (`safe-X` style):

1. Add the helper as usual (`apps/web/lib/security/safe-X.ts` + tests).
2. Add an entry to `dpf-sanitizers.model.yml`:
   ```yaml
   - addsTo:
       pack: codeql/javascript-all
       extensible: summaryModel
     data:
       - ["safe-X", "Module", "Member[assertSafeX]", "Argument[0]", "ReturnValue", "taint", "manual"]
   ```
3. Open a PR. CodeQL's next scan recognises the new sanitiser.

## Limits

- The model pack syntax may need iteration on first deployment — CodeQL's
  data-extension format has changed across versions. If a sanitiser entry
  doesn't take effect after the first scan, check the CodeQL analysis job
  logs for "extension not loaded" warnings.
- Some queries don't accept custom sanitisers (legacy queries pre-data-
  extensions). For those, dismissal via the UI remains the fallback.

## Reference

- CodeQL data-extensions docs:
  https://docs.github.com/en/code-security/codeql-cli/using-the-advanced-functionality-of-the-codeql-cli/customizing-library-models-for-javascript
- Existing kernel principle that motivates this:
  `docs/founder-kernel/wiki/principles/security-fix-needs-regression-test-first.md`
