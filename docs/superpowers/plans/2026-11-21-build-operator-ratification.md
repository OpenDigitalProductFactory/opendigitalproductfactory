# Operator control of Build Studio autonomy

BI-7C83B088 covers how an operator inspects a build policy, changes it and later identifies who authorized the change. This work belongs to Workroom WC-D904041D.

## Acceptance

- Every default-off ratification flag is listed with its decision reference and current effective value.
- Changing one is audited (who, when, which decision) and needs the operator capability.

## Implementation sequence

1. Trace each default-off reader in `apps/web/lib/build/build-studio-config.ts` to its consuming gate and recorded decision. Include the independent playbook-mode reader in `autonomous-build-phase-runtime.ts`. Identify any unused control explicitly. An item describing a feature does not by itself authorize its activation.
2. Use a shared allowlist for the controls, approved decision references, permitted values and effective source. Preserve existing environment semantics and the evidence-acceptance database key. An explicit host override must be visible. A failed database read must never grant additional authority, including inadvertently removing an enforced release check.
3. Add a capability-checked governed operator action. Resolve the acting principal from the server context and the authorizing decision from the allowlist. In one transaction validate the expected previous value, persist the change and write an audit record. A repeated request for the same state must be safe. Reject attempts to alter an environment override or unrelated key.
4. Extend the current Build Studio settings page at `/platform/ai/build-studio`. Show the effective value, source and decision. Make the control read-only for viewers and host overrides. Check the existing playbook display under Platform Development for consistency.
5. Run targeted tests for legacy settings, invalid values, environment precedence, denied writes, stale forms and transaction rollback. Verify that effective settings reach each consuming gate. Run web typecheck, prose and style guards. Exercise operator and viewer paths in a leased nonproduction environment. Do not ratify settings on the production install during verification.

## Documentation and rollback

Update the Build Studio user guide and review the cost flag activation runbook and long-running agent architecture page for impact. Regenerate affected indexes. Reverting code must preserve prior audit records. Before rollback, account for any enforced policy that the older runtime reads only from the environment.

## Backlog coverage

BI-7C83B088 is atomic. The operator form, governed writer and runtime readers must agree on the effective value before a change can be reported as ratified. There are no external item dependencies for this change.
