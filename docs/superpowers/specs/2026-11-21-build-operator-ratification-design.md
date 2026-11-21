---
status: draft
---

# Operator ratification of Build Studio settings

BI-7C83B088 gives the install operator a way to see which autonomous build decisions have been enabled and to trace a change to the person and decision behind it. The existing Build Studio page owns the controls. Operators should be able to tell whether saving a change will affect the next build.

**OBJ-1:** Show the effective value, origin and decision basis of every default-off ratification control in the Build Studio configuration.

**OBJ-2:** Apply authorized changes through one server-side action with a durable audit history and consistent runtime behavior.

| Acceptance ID | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | Every default-off ratification flag is listed with its decision reference and current effective value. |
| AC-2 | OBJ-2 | Changing one is audited (who, when, which decision) and needs the operator capability. |
| AC-3 | OBJ-1, OBJ-2 | The portal and all runtime readers agree after a change, on legacy installations, and when an explicit host override takes precedence. |
| AC-4 | OBJ-2 | Missing authority, an unsupported control, a stale form or an audit failure cannot silently change policy. |

## Runtime and storage

The configuration reader covers evidence acceptance, verified findings, pre-spec research, graduated autonomy, the one-shot lane and playbook mode. Evidence acceptance already has a PlatformConfig key and a published decision reference, DI-53037C92BC0A. Keep that key and accept the existing boolean and string encodings. Other controls currently read the process environment. Look up their decision basis before making them writable. For an unbound decision, display the delivery reference and explain why activation is unavailable. The one-shot setting has no runtime caller at the design revision. Keep it read-only until it controls dispatch.

One shared allowlist defines the exact keys, value domains, recognized environment overrides, defaults and decision references. Playbook mode accepts off, shadow and enforce. Keep explicit host values authoritative. Remove the implicit Compose assignment of off so an absent override can be distinguished from an operator who explicitly pinned off. Existing unconfigured installations continue to default to off. Preserve explicit disablement. Propagate the same resolver into both the build phase and completion paths. A storage outage must not turn an enforced release check into unchecked completion. When effective state cannot be established, hold the transition and expose the read failure.

## Operator action and interface

Use the existing platform configuration store, authenticated operator capability, governed tool execution and audit substrate. The server derives the user and timestamp, validates the requested value against the key, checks the applicable decision and rejects changes masked by an environment override. Serialize competing writers for the same key. Compare the expected state under the lock, update the setting and insert the audit event in one transaction. A duplicate request for the same committed state succeeds without creating a second transition. An audit failure rolls back the configuration write. Preserve the prior value and the new value with the actor, time, key and decision.

On the existing Build Studio settings page, group the controls by the decision each governs. Display effective source and value alongside the decision reference. Show a read-only state for viewers and explicit host overrides. Explain what is missing when the decision or consumer is unavailable. Only show success after persistence and rereading the effective value. Platform Development should display the same resolved playbook mode.

## Verification and deployment

Run targeted unit tests for resolution across legacy and new inputs. Cover authorization, override precedence, competing edits, idempotent retries and audit rollback. Exercise one operator change and a denied viewer change against a leased nonproduction install. Check which value reaches a real build phase. Verify that an unset host variable still defaults to off and an explicitly set one remains authoritative after an upgrade. Roll back application changes through the normal release path. Keep audit history, and preserve any enforced host policy when rolling back to an environment-only reader.
