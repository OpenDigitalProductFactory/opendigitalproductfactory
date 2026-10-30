import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

export async function readRegularFile(path, encoding, { openFile = open, lstatFile = lstat } = {}) {
  const handle = await openFile(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) throw new Error("Expected regular source");
    const current = await lstatFile(path, { bigint: true });
    if (!current.isFile() || current.dev !== opened.dev || current.ino !== opened.ino) throw new Error("Source identity changed");
    // Validate and read the same descriptor; never reopen the checked pathname.
    return await handle.readFile(encoding);
  } finally { await handle.close(); }
}
