import { lazyFsPromises, lazyOs } from "@/lib/shared/lazy-node";

const PRIVATE_ACTUATOR_MOUNT = "/run/dpf-actuator";
const mountPath = /^\/(?:[^\\\s\u0000]|\\(?:040|011|012|134))*$/u;

/** null means absence could not be proved from the kernel's mount table. */
function parseMountPoints(text: string): string[] | null {
  const rows = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  const points: string[] = [];
  for (const row of rows) {
    const fields = row.split(" ");
    const split = fields.indexOf("-", 6);
    if (split < 6 || fields.length !== split + 4 || fields.some(field => !field || /[\s\u0000]/u.test(field))
      || !/^\d+$/u.test(fields[0]!) || !/^\d+$/u.test(fields[1]!) || !/^\d+:\d+$/u.test(fields[2]!)
      || !mountPath.test(fields[3]!) || !mountPath.test(fields[4]!) || !/^(?:ro|rw)(?:,|$)/u.test(fields[5]!)) return null;
    points.push(fields[4]!);
  }
  return points;
}

/** Until the actuator client lands, direct log access needs proven absence.
 * A missing procfs file is expected on non-Linux development hosts only. */
export async function hasPortalActuator(): Promise<boolean> {
  try {
    const table = await lazyFsPromises().readFile("/proc/self/mountinfo", "utf8");
    const points = parseMountPoints(table);
    return points === null || points.includes(PRIVATE_ACTUATOR_MOUNT);
  } catch (error) {
    return !((error as NodeJS.ErrnoException | null)?.code === "ENOENT" && lazyOs().platform() !== "linux");
  }
}
