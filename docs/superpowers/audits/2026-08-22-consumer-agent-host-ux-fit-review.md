# Consumer Agent Host UX-Fit Review

**Decision:** Fit the consumer-install boundary into the existing Upgrade Center
instead of adding another route, navigation item, or release control.

**Owning Platform:** Upgrade Center (`/ops/self-upgrade`)

**Primary persona:** Founder or operator responsible for keeping a DPF install
current without managing source code.

**Navigation layer:** Existing contextual operations route. No new navigation
surface is introduced.

## Existing primitives reused

- `OwnerReleaseCard` remains the first owner-readable status surface.
- `Notice` and `StatCard` continue to carry semantic state and version facts.
- `SelfUpgradeTriggerControl` remains the only primary update action.
- The existing native `details` disclosure keeps run history, ledgers, and
  technical controls out of the first-view decision.

The consumer state removes an impossible action rather than adding another
choice. It states that automatic upgrades are unavailable on this installation,
keeps current-version identity visible, and points the operator to the installer
release workflow. It never labels an unverified release as current or eligible.

## Source of truth and failure behavior

The host-profile classifier owns install identity. Its support projection feeds
the server action, queue runner, MCP tools, owner summary, and trigger control.
Consumer and unknown profiles fail closed before Git resolution, queue dispatch,
drain, or promoter creation. A source checkout with upgrades disabled keeps the
existing configuration-disabled behavior.

If profile evidence cannot be read, the page renders an unavailable status with
no actionable upgrade control. It does not infer a source install or expose a
repair action that cannot work.

## AI boundary

No operator text, generated content, or private business data is sent to an AI
model. MCP initialization emits deterministic host and authority instructions;
the UI renders deterministic support state.

## Decision evidence

Kernel interaction `DI-88D1C6E4B937` compared an honest unsupported state, a
registry-digest-only signal, and a full OCI release updater. It selected the
honest unsupported state with high confidence and no principle conflict. The
corresponding machine-readable evidence is in
`docs/ux-fit/2026-08-22-consumer-agent-host.ux-fit.json`.

## Verification targets

- Desktop and narrow viewports preserve the owner summary as the first decision
  surface and expose no consumer upgrade trigger.
- Both light and dark themes retain token-based contrast and semantic notice
  treatment.
- Focused component and page tests cover consumer unavailable, source enabled,
  and unknown fail-closed states.
