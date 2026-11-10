/**
 * Confirming a site's location is foreground and one-shot (BI-C318C227 §2.2,
 * AC-ALC-VISIT-4). This guard fails if the app gains background location: a
 * background mode, the "Always" permission, or the task manager that drives
 * background updates. Live staff tracking has its own item (BI-D5549DE2).
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..", "..", "..");
const appJson = readFileSync(join(root, "app.json"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("no background location", () => {
  it("declares no iOS background location mode or Always permission", () => {
    expect(appJson).not.toMatch(/"location"\s*[\],]/);
    expect(appJson).not.toMatch(/NSLocationAlwaysAndWhenInUseUsageDescription|NSLocationAlwaysUsageDescription/);
    expect(appJson).not.toMatch(/isIosBackgroundLocationEnabled"\s*:\s*true/);
  });

  it("declares no Android background location permission", () => {
    expect(appJson).not.toMatch(/ACCESS_BACKGROUND_LOCATION/);
    expect(appJson).not.toMatch(/isAndroidBackgroundLocationEnabled"\s*:\s*true/);
  });

  it("does not depend on expo-task-manager", () => {
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("expo-task-manager");
  });
});
