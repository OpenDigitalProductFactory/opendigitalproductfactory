# Windows Installer Drive Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows installer recommend a non-C install drive when C is low on space, check disk space against the selected install drive, and warn when Docker Desktop storage is still on a crowded C drive.

**Architecture:** Keep `install-dpf.ps1` self-contained because README documents downloading that single script before the repo exists. Add pure helper functions inside the installer, expose a `-LibraryOnly` test seam, and cover the behavior with Pester tests that dot-source the installer without running the install flow.

**Tech Stack:** PowerShell 5.1-compatible installer script, Pester 5 tests, existing DPF Windows install documentation.

---

### Task 1: Installer Helper Test Seam

**Files:**
- Modify: `install-dpf.ps1`
- Create: `scripts/installer/windows-install-drive.Tests.ps1`

- [ ] **Step 1: Write the failing test**

Add a Pester test that dot-sources `install-dpf.ps1 -LibraryOnly` and expects helper functions such as `Get-DPFDriveInventory`, `Get-DPFInstallDriveRecommendation`, `Get-DPFInstallDriveFreeSpace`, and `Get-DPFDockerStorageRecommendation` to exist.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pwsh -NoProfile -Command "Invoke-Pester -Path scripts/installer/windows-install-drive.Tests.ps1 -Output Detailed"`

Expected: FAIL because the helper functions and `-LibraryOnly` test seam do not exist yet.

- [ ] **Step 3: Add the minimal test seam**

Move the install-directory prompt below helper function declarations and add `[switch]$LibraryOnly`; when it is set, the script returns after loading helper functions and before prompting, writing files, or starting installer steps.

- [ ] **Step 4: Run the test to verify the seam loads**

Run the same Pester command. Expected: helper-existence tests pass or fail only on not-yet-implemented helper behavior.

### Task 2: Drive Recommendation Behavior

**Files:**
- Modify: `install-dpf.ps1`
- Test: `scripts/installer/windows-install-drive.Tests.ps1`

- [ ] **Step 1: Write failing behavior tests**

Cover these cases:
- when `C:` has less than the recommended free-space threshold and `D:` has room, default to `D:\DPF`;
- when `D:` is too small but `E:` has room, default to `E:\DPF`;
- when `C:` has enough room, keep `C:\DPF`;
- the disk-space check resolves the selected install drive rather than hardcoding `C:`.

- [ ] **Step 2: Run the tests red**

Run: `pwsh -NoProfile -Command "Invoke-Pester -Path scripts/installer/windows-install-drive.Tests.ps1 -Output Detailed"`

Expected: FAIL with missing or incorrect recommendation behavior.

- [ ] **Step 3: Implement the minimal helper functions**

Add pure helper functions that normalize fixed-drive inventory, sort non-C candidates by drive letter, pick the first drive meeting the recommended threshold, and resolve free space for the selected install root.

- [ ] **Step 4: Wire the prompt and hardware check**

Use the helper result when the installer is not already running from a repo checkout, print the plain-English recommendation before `Read-Host`, and replace the hardware check's `DeviceID='C:'` lookup with a selected-install-drive lookup.

- [ ] **Step 5: Run focused tests green**

Run the Pester command and fix any regression.

### Task 3: Docker Storage Warning and Docs

**Files:**
- Modify: `install-dpf.ps1`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-03-14-windows-installer-design.md`
- Test: `scripts/installer/windows-install-drive.Tests.ps1`

- [ ] **Step 1: Write failing warning tests**

Cover a Docker Desktop data path under `C:\Users\<user>\AppData\Local\Docker\wsl\disk`, a crowded `C:`, and a non-C fixed drive with enough room. Expected target: `<drive>\DockerDesktop\wsl\disk`.

- [ ] **Step 2: Implement warning-only behavior**

Print a warning/suggestion during the install prompt. Do not move Docker storage automatically.

- [ ] **Step 3: Update docs**

Update README's default language and the Windows installer spec so `C:\DPF` is the default only when no better non-C drive recommendation is available.

- [ ] **Step 4: Verify and commit**

Run Pester, inspect the diff, then commit with `git commit -s` and push the branch.
