# Recover Codex plugins and hook trust

A configuration error can stop both the Plugins screen and message submission.
A duplicate-key error names the configuration file that must be repaired; it
does not establish that every installed plugin has failed independently.

## Repeated Windows notify errors

Codex uses the root `notify` entry to call its completion helper. In the affected
Windows desktop versions, runtime repair reads a quoted `"notify"` key but
removes only the bare `notify` spelling before appending its replacement. The
older DPF permission writer quoted every key. Together these writers can leave
two equivalent root keys, and TOML then refuses the configuration.

Deleting only the appended entry leaves the quoted original and permits the
same failure at another runtime refresh. Ask the agent to repair the known
configuration defect with a backup, rather than repeatedly deleting a line.

The agent must preserve unrelated settings, verify the intended callback and
its existing helper, and leave exactly one bare root `notify` entry. Custom
callbacks or ambiguous invalid files require inspection; the agent must not
guess which values to discard. Signed desktop binaries and runtime versions
are not patched or pinned as a repair.

The corrected DPF serializer emits legal bare keys and quotes keys only when
necessary. It also normalizes the historical literal quoted `notify` spellings
through the existing validated permission plan, even when permission values
are unchanged. Dry-run, backups, concurrent-edit checks and atomic replacement
remain in force. Already-invalid duplicate-key files are refused by that plan
and need the bounded configuration repair first.

## Hooks marked modified after an update

Hook approval belongs to Codex and applies to the current definitions. An
updated plugin can make previously approved handlers appear as **modified**.
An old acknowledgement or saved hash does not prove that the new definitions
are trusted, enabled or complete.

After the final plugin update settles, review the current definitions in
Codex's Hooks screen and trust the ones you approve. The agent then verifies
Codex's per-handler inventory against the required roster, including event,
matcher, command, timing and enabled state. Missing, disabled, modified or
unavailable handlers remain unverified. DPF does not grant trust automatically.

## Verify recovery

The agent checks that the configuration parses, the completion helper exists,
and the plugin surface loads. It checks the current native hook inventory
separately: configuration repair does not approve hooks, and trusted inventory
does not demonstrate that a hook has executed. Prevention is delivered only
when the signed updater containing the serializer repair is installed and the
runtime-replacement regression checks pass.
