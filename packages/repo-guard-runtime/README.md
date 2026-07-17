# Repository guard runtime

This private workspace owns parser-grade dependencies used by root repository guards without installing application workspaces. Provision it with:

```text
pnpm install --frozen-lockfile --ignore-scripts --filter @dpf/repo-guard-runtime
```

The loader verifies the exact manifest pin, lockfile importer, resolved pnpm path, package version, and loaded module version. It fails instead of using an unowned ancestor dependency.

