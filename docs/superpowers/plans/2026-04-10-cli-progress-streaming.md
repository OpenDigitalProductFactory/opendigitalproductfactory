# CLI Progress Streaming for Codex and Claude Code Dispatch

## Problem

When Codex CLI or Claude Code CLI runs a build task in the sandbox, the user sees "Software Engineer is still working (329s)" with no indication of what's happening. Tasks can run 5-20 minutes. The CLI's stderr has progress messages but we redirect them to /dev/null.

## Goal

Stream real-time progress from both CLIs to the Build Studio UI via the agent event bus, so the user sees what the CLI is doing: "Reading schema.prisma...", "Editing route.ts...", "Running prisma validate..."

## Current Architecture

Both `codex-dispatch.ts` and `claude-dispatch.ts`:
1. Write prompt to temp file in sandbox container
2. Run CLI via `docker exec` with `execAsync` (child_process.exec)
3. Redirect stderr to `/dev/null`
4. Capture stdout on completion
5. Return result

The `agentEventBus` emits `orchestrator:task_dispatched` before and `orchestrator:task_complete` after, but nothing during execution.

## Implementation: Codex CLI

### Codex stderr format
Codex CLI writes progress to stderr. Typical output:
```
Reading prompt from stdin...
OpenAI Codex v0.118.0
Reading file: packages/db/prisma/schema.prisma
Editing file: packages/db/prisma/schema.prisma
Running command: pnpm --filter @dpf/db exec prisma validate
Command output: ✔ Prisma schema is valid
```

### Changes to codex-dispatch.ts

Replace `execAsync` (which buffers all output) with `spawn` (which streams):

```typescript
import { spawn } from "child_process";

// Instead of:
const { stdout } = await execAsync(`docker exec ... 2>/dev/null`);

// Use:
const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
  const proc = spawn("docker", [
    "exec", SANDBOX_CONTAINER, "sh", "-c",
    `cd /workspace && codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check ${modelFlag} < /tmp/codex-prompt.txt`
  ], { timeout: timeoutMs });

  let stdout = "";
  let stderr = "";

  proc.stdout.on("data", (data) => { stdout += data.toString(); });
  
  proc.stderr.on("data", (data) => {
    const line = data.toString().trim();
    stderr += line + "\n";
    
    // Parse progress from stderr and emit events
    if (line.startsWith("Reading file:")) {
      const file = line.replace("Reading file: ", "");
      onProgress?.(`Reading ${file}`);
    } else if (line.startsWith("Editing file:")) {
      const file = line.replace("Editing file: ", "");
      onProgress?.(`Editing ${file}`);
    } else if (line.startsWith("Running command:")) {
      const cmd = line.replace("Running command: ", "");
      onProgress?.(`Running: ${cmd.slice(0, 80)}`);
    } else if (line.startsWith("Writing file:")) {
      const file = line.replace("Writing file: ", "");
      onProgress?.(`Creating ${file}`);
    }
  });

  proc.on("close", (code) => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(Object.assign(new Error(`Exit code ${code}`), { stdout, stderr, code }));
  });
  
  proc.on("error", reject);
});
```

Add `onProgress` callback to `dispatchCodexTask`:
```typescript
export async function dispatchCodexTask(params: {
  // ... existing params ...
  onProgress?: (message: string) => void;
}): Promise<CodexResult>
```

### Wire to event bus in build-orchestrator.ts

```typescript
const result = await dispatchCodexTask({
  ...taskParams,
  onProgress: (message) => {
    agentEventBus.emit(parentThreadId, {
      type: "orchestrator:task_dispatched",
      buildId,
      taskTitle: `${task.title}: ${message}`,
      specialist: ROLE_LABELS[role],
    });
  },
});
```

### UI update in AgentCoworkerPanel.tsx

The UI already handles `orchestrator:task_dispatched` events and shows the `taskTitle`. By including the progress message in the title, the UI updates automatically without any frontend changes.

## Implementation: Claude Code CLI

### Claude Code stderr format
Claude Code CLI writes progress to stderr:
```
Thinking...
Reading file: apps/web/lib/actions/agent-coworker.ts
Writing file: apps/web/app/api/training/route.ts
Running bash command: pnpm exec tsc --noEmit
```

### Changes to claude-dispatch.ts

Same pattern as Codex — replace `execAsync` with `spawn`, parse stderr lines, emit progress:

```typescript
proc.stderr.on("data", (data) => {
  const line = data.toString().trim();
  stderr += line + "\n";
  
  if (line.startsWith("Reading file:")) {
    onProgress?.(`Reading ${line.replace("Reading file: ", "")}`);
  } else if (line.startsWith("Writing file:")) {
    onProgress?.(`Writing ${line.replace("Writing file: ", "")}`);
  } else if (line.startsWith("Running bash command:")) {
    onProgress?.(`Running: ${line.replace("Running bash command: ", "").slice(0, 80)}`);
  } else if (line === "Thinking...") {
    onProgress?.("Thinking...");
  }
});
```

## New SSE Event Type (Optional Enhancement)

Instead of overloading `orchestrator:task_dispatched`, add a dedicated event:

```typescript
| { type: "orchestrator:task_progress"; buildId: string; taskTitle: string; message: string }
```

Frontend handler in AgentCoworkerPanel.tsx:
```typescript
if (data.type === "orchestrator:task_progress") {
  setOrchestratorStatus(`${data.taskTitle}: ${data.message}`);
}
```

## Timeout Improvements (Already Committed)

- Default: 15 minutes (was 10)
- Data-architect (schema) tasks: 20 minutes
- Same timeouts should apply to Claude Code dispatch

## Files to Change

1. `apps/web/lib/integrate/codex-dispatch.ts` — spawn instead of exec, parse stderr, add onProgress
2. `apps/web/lib/integrate/claude-dispatch.ts` — same pattern
3. `apps/web/lib/integrate/build-orchestrator.ts` — pass onProgress callback
4. `apps/web/lib/tak/agent-event-bus.ts` — add `orchestrator:task_progress` event type (optional)
5. `apps/web/components/agent/AgentCoworkerPanel.tsx` — handle new event type (optional)

## Effort Estimate

Small-medium change. The core work is replacing `exec` with `spawn` in two files and parsing stderr lines. The event bus and UI already have the infrastructure — it's mostly wiring.
