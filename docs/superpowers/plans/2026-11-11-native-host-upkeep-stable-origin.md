# Native host-upkeep stable origin implementation plan

BI-7EE97802 / WC-C41B707A. This is one atomic installer-address repair.
Design: `../specs/2026-11-11-native-host-upkeep-stable-origin.md`.

1. Reproduce endpoint selection in isolated native-installer fixtures. Cover a
   changed LAN address, configured canonical origin, explicit authority, full
   Edge mode, no configured origin and malformed input. Preserve the failing
   before-fix result for AC-UPKEEP-CANONICAL/MOBILITY/COMPATIBILITY.
2. Amend the existing shell and PowerShell native installers to select the
   co-located upkeep API origin without changing full Edge advertisement or
   explicit authority semantics. Validate before service replacement. Reuse
   canonical configuration readers. Keep enrollment and rollback unchanged
   (AC-UPKEEP-EXPLICIT/IDENTITY).
3. Update fleet operations, the Mac inference installer description and the
   platform support watchlist. Regenerate only required derived documentation
   artifacts. Run affected script tests, shell syntax, available PowerShell
   checks and the governed exact-tree verification gate. Report unavailable
   native platform checks as unrun, never as passes.
4. Obtain independent review and publish a DCO-signed protected PR. Merge through
   the queue; coordinate one canonical upgrade with the existing actuator.
5. Use the supported native installer/update path, preserving the enrolled node
   and all trust material. Read the canonical node's fresh heartbeat and service
   state. Close only this repair's proven outcomes, leaving all-install and
   original host-upkeep acceptance qualifications explicit (AC-UPKEEP-LIVE).

Stop a denied operation and follow its returned remedy. This plan grants no new
budget, provider, credential or peer action, and cannot settle an older unknown
review execution or bypass a native admission/publication gate.
