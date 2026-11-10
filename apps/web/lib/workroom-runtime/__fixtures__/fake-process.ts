// A fake agent-CLI process for runtime tests: records what the adapter writes
// and lets a test play the CLI's side of the conversation.

import type { RuntimeLaunch, RuntimeProcess } from "../sandbox-launcher";

export type FakeProcess = RuntimeProcess & {
  launch: RuntimeLaunch | null;
  written: Array<Record<string, unknown>>;
  emit(frame: Record<string, unknown>): void;
  exit(code: number | null): void;
  killed: boolean;
};

export function fakeProcess(): FakeProcess {
  const data: Array<(chunk: string) => void> = [];
  const closes: Array<(code: number | null) => void> = [];
  const proc: FakeProcess = {
    launch: null,
    written: [],
    killed: false,
    write(line) {
      for (const part of line.split("\n")) if (part.trim()) proc.written.push(JSON.parse(part) as Record<string, unknown>);
    },
    onData(listener) { data.push(listener as (chunk: string) => void); },
    onStderr() {},
    onClose(listener) { closes.push(listener); },
    end() {},
    kill() { proc.killed = true; },
    emit(frame) { for (const listener of data) listener(`${JSON.stringify(frame)}\n`); },
    exit(code) { for (const listener of closes) listener(code); },
  };
  return proc;
}

/** Answer each request the adapter sends, as the CLI would. */
export function autoRespond(proc: FakeProcess, answers: Record<string, unknown>): void {
  const write = proc.write.bind(proc);
  proc.write = (line) => {
    write(line);
    const frame = JSON.parse(line) as { id?: number; method?: string };
    if (frame.id != null && frame.method && frame.method in answers) {
      queueMicrotask(() => proc.emit({ id: frame.id, result: answers[frame.method!] }));
    }
  };
}
