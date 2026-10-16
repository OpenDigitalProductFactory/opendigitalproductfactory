# Review coworker permissions

Open Platform > AI Workforce, select a coworker, then open Capabilities.
The **Saved permissions** editor is the single home for granting and removing
this coworker's permissions. Search for a permission to add it, or choose
**Remove** beside an assigned permission. Successful changes show a saved notice.

Fresh and already reconciled installs need no extra setup. Upgrades retire
matching duplicate permission records automatically, preserving current decisions.
Execution aliases remain available for existing skills and service references;
the original permission decisions are preserved in the authority audit trail.

External coding coworkers receive the standard permissions to find and request
reviews during setup and upgrades. Permissions you removed stay removed.
A coworker awaiting permission review does not hold up another coworker's setup.
An administrator can review differences in the portal even when that coworker's
connection cannot request reviews. Administrative access remains a separate choice.

Only unresolved differences show **Review permission differences**. An
administrator can keep current permissions for all differences or use the
previous permissions for all, then open **Review individually** to override
individual choices. **Approve choices** asks for confirmation before applying
the displayed selection and retiring the previous permission record. Current
access remains in place until approval. If permissions changed after preview,
review again: stale choices are cleared and cannot be resubmitted. Removed
permissions stay removed through reconnects and upgrades.

The next request uses the current saved permissions, including after reconnect.
A saved grant alone does not guarantee access: token scope, human role, room
permissions and execution policy also apply. The assistant's diagnostic profile
reports its canonical identity and grant eligibility for its connection.

The authority audit and agent cards read the same saved permissions, including
removals. A failed read shows a load error rather than setup defaults.

Permission changes require administrator authority. An assistant cannot change
its own grants through the MCP grant manager. The identity repair does not add
diagnostic or administrative grants automatically.
