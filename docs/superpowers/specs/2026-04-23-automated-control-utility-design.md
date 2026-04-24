# Automated Control Utility Design

**Date:** 2026-04-23  
**Status:** Draft  
**Author:** OpenAI Codex with user direction  
**Epic:** `EP-CTRL-5E21A4` - `Automated Control Utility: Desktop QA and Remote Assist Foundation`

## 1. Problem Statement

DPF needs a reusable automation utility that can operate Windows desktops the way a technician or QA operator would, but with stronger evidence, policy, and orchestration than a generic remote desktop tool.

The immediate high-value use case is not arbitrary end-user takeover. It is:

- preparing a fresh Windows host
- installing prerequisites such as Docker Desktop
- installing or launching DPF itself
- walking through initial configuration
- executing smoke QA against the resulting install
- producing evidence good enough for release and install verification

Longer term, the same substrate should support supervised remote assistance for employee and customer systems, including MSP-style customer support scenarios. However, the first productized workflow is Windows-first desktop QA and install automation on managed sandbox hosts.

## 2. Live Backlog Context

Per repo guardrails, the live PostgreSQL backlog was checked before defining new scope.

Observed live epic state when this design was written:

- `EP-SITE-7C4D2B` - `Customer Site Records & Location Validation`
- `EP-LAB-6A91C2` - `Integration Lab Sandbox & Private Connectivity Foundation`
- `EP-INT-2E7C1A` - `Integration Harness: Benchmarking and Private Deployment Foundation`
- `EP-BUILD-9F749C` - `Code Graph Ship Test — Ship Tracking` (`done`)

No live epic covered a general-purpose automated desktop control utility, so a new epic was created in the live DB:

- `EP-CTRL-5E21A4` - `Automated Control Utility: Desktop QA and Remote Assist Foundation`

Seeded backlog items under that epic:

1. benchmark open-source control stacks
2. design a unified control-plane model
3. implement Windows desktop automation adapter
4. implement macOS desktop automation adapter
5. add vision/OCR fallback
6. build an unsupervised desktop QA runner
7. add supervised remote-session brokering
8. ship a human operator console
9. enforce audit and safety policy controls
10. design MSP-grade tenant isolation and consent rules

## 3. Scope and Anchor Workflow

### 3.1 Primary v1 Anchor

The reference workflow for v1 is:

1. bootstrap or connect to a Windows host with local administrator rights
2. verify machine readiness for DPF install
3. install prerequisites such as Docker Desktop and required Windows settings
4. install or launch DPF
5. wait for platform health
6. drive the initial setup/configuration flow
7. execute smoke QA against the running install
8. report evidence and final verdict back to DPF

### 3.2 Initial Product Boundary

v1 is explicitly for:

- managed Windows sandbox/install hosts
- classic corporate/business desktop software
- unattended install/bootstrap and desktop QA
- evidence-first verification

v1 is explicitly not for:

- arbitrary unattended control of employee production desktops
- broad consumer remote desktop use
- game-like or highly animated custom desktop surfaces
- macOS-first delivery

### 3.3 Long-Term Shared Utility Boundary

The feature is intentionally dual-use:

- `desktop QA and install automation` first
- `supervised remote assistance` later

That means the architecture should not become a one-off install bot. It should become a shared control substrate that can later power:

- supervised employee support
- MSP/customer remote support
- human operator takeover
- broader workstation automation

## 4. Research & Benchmarking

This design follows the repo requirement to benchmark both open-source and commercial best-of-breed solutions before finalizing the spec.

### 4.1 Open-Source Systems Reviewed

#### RustDesk

- Open-source remote desktop application with self-hosting support
- Strong reference for supervised remote-control transport and operator expectations
- Useful pattern: brokered remote session model rather than ad hoc desktop scripting
- Not adopted as the full automation core because remote transport alone does not provide QA-grade structured control, evidence semantics, or release-gate reporting

Reference:

- https://github.com/rustdesk/rustdesk

#### MeshCentral

- Open-source remote monitoring and management platform
- Strong reference for agent-based host management, fleet visibility, and operator-led remote support
- Useful pattern: managed host inventory plus central administrative control
- Not adopted wholesale because the target here is a DPF-native automation substrate with deeper typed action/evidence semantics

Reference:

- https://github.com/Ylianst/MeshCentral

#### pywinauto

- Practical Windows automation framework with Win32 and UI Automation backends
- Strongest immediate reference for accessibility-first control of classic Windows business applications
- Pattern adopted: use structured UI automation first, then fall back to keyboard/mouse when controls are not directly invokable

Reference:

- https://pywinauto.readthedocs.io/en/latest/getting_started.html

#### Appium Windows Driver / WinAppDriver

- Reference pattern for Selenium/Appium-style Windows application automation
- Useful for thinking about a typed action contract and driver model
- Not chosen as the sole substrate because WinAppDriver maturity is weaker than the surrounding long-term product needs and because bootstrap/install workflows need closer host/session control than a pure app-driver abstraction

References:

- https://github.com/appium/appium-windows-driver
- https://github.com/microsoft/WinAppDriver

#### Appium Mac2 Driver and Hammerspoon

- Relevant follow-on references for macOS support
- Useful for proving that the long-term architecture should separate control-plane concerns from OS-specific adapter concerns
- Not a v1 adoption target because Windows is the first reference implementation

References:

- https://github.com/appium/appium-mac2-driver
- https://www.hammerspoon.org/

#### SikuliX, PyAutoGUI, and Tesseract

- Reference stack for vision-driven fallback, OCR, and low-level input automation
- Pattern adopted: vision and OCR should be fallback layers, not the only “eyes”
- Pattern rejected: screenshot-only primary control model for corporate QA, because it is less explainable and less stable for release-gate evidence

References:

- https://sikulix.github.io/docs/
- https://autogui.readthedocs.io/en/latest/index.html
- https://github.com/tesseract-ocr/tesseract

### 4.2 Commercial Best-of-Breed References

#### Microsoft Power Automate Desktop

- Strong benchmark for attended/unattended Windows automation, desktop flow authoring, and RPA-style system control
- Pattern adopted: corporate desktop automation is usually about business systems and install/configure/support flows, not free-form “AI taking over a PC”
- Pattern adopted: supervised and unsupervised modes should be treated differently

References:

- https://learn.microsoft.com/en-us/power-automate/desktop-flows/desktop-automation
- https://learn.microsoft.com/en-us/power-automate/desktop-flows/run-unattended-desktop-flows
- https://learn.microsoft.com/en-us/power-automate/desktop-flows/run-desktop-flows-pip

#### UiPath

- Strong benchmark for enterprise RPA positioning, especially repetitive back-office and desktop automation
- Pattern adopted: typed action execution, centralized orchestration, and evidence/audit matter more than raw desktop control

Reference:

- https://www.uipath.com/automation/desktop-automation

#### Remote support vendors (TeamViewer-style market category)

- Strong benchmark for supervised support expectations: consent, session visibility, operator control, file/system access boundaries
- Pattern adopted: remote-support mode must be brokered, supervised, and policy-bound
- Pattern rejected: treating remote support transport as equivalent to QA automation

### 4.3 Patterns Adopted

1. central orchestration with host-side execution workers
2. accessibility/UI automation first for Windows business apps
3. vision/OCR as fallback rather than primary control plane
4. separate unattended QA authority from supervised support authority
5. evidence-first reporting with step-level auditability
6. reusable host agent/runner that survives beyond one install workflow

### 4.4 Patterns Rejected

1. screenshot-only control as the default for release-gate QA
2. one-off install scripts disconnected from later QA/runtime control
3. pure remote desktop transport without structured action semantics
4. platform orchestration that assumes DPF already exists on the target host
5. broad unattended control of arbitrary employee/customer desktops in v1

### 4.5 Anti-Patterns to Avoid

1. brittle coordinate-only automation with no semantic target identity
2. “bot says it passed” reporting without screenshots and step logs
3. weak resume behavior after reboot, installer restart, or Docker launch transitions
4. silent escalation from sandbox QA authority to remote support authority
5. cross-tenant or cross-customer evidence leakage in future MSP mode

## 5. Core Design Decision

The Automated Control Utility should be a `bootstrap-to-central hybrid`:

- a lightweight Windows bootstrap runner starts first on the host
- that runner can operate before DPF is installed
- once DPF is healthy, orchestration and evidence ownership move to the central control plane
- the runner remains as the local execution worker after handoff

This avoids two bad extremes:

- `pure central orchestration` fails before DPF exists on the machine
- `pure standalone host agent` fragments evidence, policy, and machine history

## 6. Architecture

### 6.1 Control-Plane Split

The system should have two layers:

#### Central control plane in DPF

Responsibilities:

- store run definitions and machine inventory
- manage policy and approvals
- receive live progress and evidence
- persist run history
- surface operator visibility
- own final verdicts and release/install reporting

#### Windows runner process on the host

Responsibilities:

- operate in a real Windows GUI session
- inspect classic desktop applications
- launch installers and processes
- read structured UI metadata
- fall back to keyboard/mouse and vision/OCR when necessary
- journal local state before DPF exists
- sync all evidence centrally once DPF is reachable

### 6.2 Lifecycle

1. bootstrap runner is invoked on the Windows host with local admin rights
2. runner verifies readiness and begins journaling locally
3. runner installs prerequisites and launches DPF
4. runner detects DPF health and registers the run/session
5. DPF becomes the system of record for the remainder of execution
6. runner continues executing steps and syncing evidence

### 6.3 Operating Modes

#### Bootstrap / Install QA mode

- unattended allowed
- sandbox/managed host only
- purpose-built for install, setup, and verification flows

#### Future remote assist mode

- supervised by default
- session brokering, consent, and operator visibility required

#### Human operator mode

- person can launch, watch, pause, approve, take over, and return control

## 7. Windows Runner Capability Model

The Windows runner should provide five capability groups.

### 7.1 Host Preparation

- inspect machine readiness
- install software and prerequisites
- launch and monitor processes
- edit expected install/config state
- handle reboot-required transitions
- resume after process or machine restart

### 7.2 Desktop Control

- inspect Windows UI Automation / Win32 metadata
- locate target windows and controls
- invoke controls directly where possible
- use keyboard/mouse when direct invoke is not available
- interact with classic corporate desktop apps and installers

### 7.3 Run Durability

- persist checkpoints locally
- resume after installer restarts, Docker startup delays, or OS restart
- keep deterministic run state rather than re-inferring everything from screenshots

### 7.4 Evidence Capture

- capture screenshots before/after major steps
- snapshot resolved controls and window metadata
- record actions and outcomes
- tag each step with confidence and evidence source

### 7.5 Central Reporting

- buffer locally before DPF is reachable
- sync runs, evidence, and final state to the DPF control plane after handoff

## 8. Perception and Control Model

### 8.1 Priority Order

The runner should operate in this order:

1. `structured automation first`
2. `input fallback second`
3. `vision/OCR fallback third`

### 8.2 Why This Order

Corporate desktop QA needs explainability and repeatability. For classic Windows business apps, structured metadata usually provides a better foundation than screenshots alone.

Vision remains necessary for:

- custom-drawn controls
- installers with weak automation metadata
- partially remote-rendered surfaces
- dialogs or transient states not exposed cleanly to UI automation

### 8.3 Internal Modules

#### Session manager

- active desktop/session state
- current app/window tracking
- resolution and environment tracking
- checkpoint coordination

#### Host actions module

- install software
- launch processes
- wait for services
- manage restart/reboot transitions

#### UI inspector

- read structured controls
- normalize Windows-specific metadata into an internal control model

#### Vision service

- screenshot capture
- OCR
- image matching and fallback target discovery

#### Action executor

Typed actions such as:

- `open_app`
- `wait_for_window`
- `click_control`
- `type_text`
- `select_menu`
- `verify_text`
- `capture_evidence`

#### Evidence recorder

- screenshots
- step logs
- control snapshots
- confidence
- timing
- final pass/fail reasoning

#### Run journal

- durable local state for resume and recovery

#### Central sync client

- local buffering pre-handoff
- central synchronization post-handoff

### 8.4 Core Rule

Every action must be typed and evidence-backed.

The utility should not primarily think in terms of raw screen coordinates. It should think in terms of intentful, auditable actions against resolved UI targets, with explicit fallback annotations when that target resolution had to rely on vision.

## 9. Safety and Evidence Model

### 9.1 Safety Boundaries

v1 should enforce:

- machine registration and managed-host targeting
- run definitions with declared intent
- scope-limited action policy
- stop/pause controls
- checkpoint-based resume
- controlled secret input handling

### 9.2 Evidence Requirements

Every major transition should produce evidence, especially:

- machine readiness
- Docker/Desktop prerequisite installation
- DPF launch/health
- initial configuration completion
- smoke QA checkpoints
- final verdict

### 9.3 Confidence Model

Run reports should distinguish:

- `structured-control steps`
- `input-fallback steps`
- `vision/OCR fallback steps`

This matters because a release/install gate should treat a structured-control pass differently from a pass that required repeated vision-only heuristics.

### 9.4 Final Report Shape

The final report should include:

- run metadata and machine identity
- step-by-step action log
- screenshots and control evidence
- evidence-source tags and confidence
- failure details with last-known UI state
- install summary
- smoke-verification summary
- final verdict

## 10. Data Model Stewardship

This feature needs a canonical control-domain model rather than scattering session state across unrelated install, QA, or audit tables.

Likely canonical records:

- `ManagedHost`
- `ControlRun`
- `ControlSession`
- `ControlStep`
- `ControlEvidence`
- `ControlPolicy`

Important stewardship rule:

- do not overload existing browser-use or generic workflow records with desktop-runner semantics
- do not overload MSP-specific models with general control-plane primitives

The general-purpose control utility should own the canonical records. MSP/customer support mode can later reference those records with stricter tenant, consent, and identity rules.

## 11. Relationship to Existing DPF Architecture

This feature should align with existing DPF patterns:

- `browser-use` remains the reference pattern for evidence-first browser QA
- the new utility extends that philosophy to Windows desktop/session automation
- DPF remains the orchestration and reporting plane
- host-side runners remain isolated execution workers

It should also align with the existing execution-adapter/computer-use direction in the repo, but it should not depend on provider-hosted “computer use” alone. Provider tools may later inform decision-making or fallback reasoning, but the core Windows runner must remain DPF-controlled and self-hostable.

## 12. Rollout Recommendation

### Phase 1

- benchmark stack and finalize Windows-first substrate
- define control-plane and runner contracts
- implement bootstrap journaling and evidence model
- automate fresh Windows host install through DPF health and initial smoke verification

### Phase 2

- harden structured UI inspection and typed action library
- improve vision/OCR fallback quality
- add richer operator visibility and replay/debug surfaces

### Phase 3

- introduce supervised remote-support mode
- add human takeover console
- add MSP-grade tenant isolation and customer consent rules
- add macOS runner using the same control-plane contract

## 13. Acceptance Criteria

1. DPF can define and track a Windows bootstrap/install QA run centrally.
2. A host-side Windows runner can begin execution before DPF is installed.
3. The runner can install prerequisites, launch DPF, and hand off to central orchestration after health detection.
4. The runner uses structured Windows automation first and vision/OCR fallback second.
5. Each major step produces durable evidence.
6. The runner can survive restart/reboot transitions using local journals/checkpoints.
7. Final reports distinguish structured-control and vision-fallback confidence.
8. v1 remains scoped to managed sandbox/install hosts, not arbitrary production desktop takeover.
9. The design remains extensible to supervised remote support and human takeover without replacing the core control model.

## 14. Final Recommendation

DPF should build a general-purpose Automated Control Utility whose first productized workflow is:

`fresh Windows host bootstrap + DPF install + initial configuration + smoke verification`

The correct shape is:

- central orchestration and evidence in DPF
- a separate Windows runner process on the host
- accessibility-first desktop control
- vision/OCR fallback when needed
- sandbox-focused unattended QA in v1
- supervised remote support later on the same substrate

This gives DPF a reusable machine-automation foundation that is immediately valuable for installation QA and can later evolve into broader workstation automation and MSP/customer support workflows without discarding the original design.
