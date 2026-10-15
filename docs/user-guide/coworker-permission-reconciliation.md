# Review coworker permissions

Open Platform > AI Workforce, select a coworker, then open Capabilities.
Saved tool grants apply to the coworker's canonical identity. Legacy execution
records may still hold different grants, but they do not control access.

An administrator can select **Review legacy permissions** to compare those
records. Choose Current or Legacy for each difference, then **Approve choices**.
The confirmation applies only the choices shown. If permissions changed after
the preview, reload it and review the changes again. Keeping Current preserves
the current grant or revocation; selecting Legacy applies that saved state to
the canonical record. A revoked or deliberately removed grant stays removed
across provisioning. Legacy records remain available as historical evidence.

The next request uses the current saved permissions, including after reconnect.
A saved grant alone does not guarantee access: token scope, human role, room
permissions and execution policy also apply. The assistant's diagnostic profile
reports its canonical identity and grant eligibility for its connection.

Permission changes require administrator authority. An assistant cannot change
its own grants through the MCP grant manager. The identity repair does not add
diagnostic or administrative grants automatically.
