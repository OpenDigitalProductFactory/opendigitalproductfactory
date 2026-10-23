---
status: active
backlog: BI-0ACB97B5
---

# Boot watchdog backstop

This is a delivery dependency under WC-B5D4B788 and the existing timing defect BI-5BB59C18. Canonical gate cmv7xhsqt18wf01r47l5uwevr on 51b5708a7cfe3ce516eb76d98c2522f565f96975 recorded a portable watchdog failure: the Node spawn backstop returned null/SIGTERM/ETIMEDOUT instead of the shell watchdog's required status 124. The same case passed in an isolated source-local run. The prior 2.5-second wall-clock assertion has already been removed; this reproduction concerns the outer process budget.

Retain the primary one-second deadline, its one-second kill grace, the 30-second Vitest case budget and status-124 assertion. The outer Node backstop must leave room for shell startup before the primary watchdog begins. Reuse the existing ten-second boot subprocess budget as a minimum outer fail-safe; ordinary ten-second cases keep their existing twelve-second outer budget.

First add a test-only startup delay before the watchdog starts. A three-second delay plus the one-second deadline must still return 124; the current three-second parent budget must fail that regression. Change only the test harness's outer budget to max(existing ten-second budget, primary deadline plus two seconds), then rerun both native and portable cases and the whole boot fixture. No product boot script, runtime deadline, assertion removal or global test budget changes.

Keep explicit timed-out status, exact watchdog exit 124 and absence of the server marker as behavioral checks. A disabled watchdog that lets the fake migration finish returns zero and must still fail; the parent backstop returning null must also fail. Obtain independent review and final canonical verification. A focused pass is not a full gate pass.
