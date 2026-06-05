import { describe, expect, it } from "vitest";
import { taskStateIntent, isTaskInFlight } from "./task-state-intent";

describe("taskStateIntent", () => {
  it("maps terminal-success states to success", () => {
    expect(taskStateIntent("completed")).toBe("success");
    expect(taskStateIntent("archived")).toBe("success");
  });
  it("maps failure states to danger", () => {
    expect(taskStateIntent("failed")).toBe("danger");
    expect(taskStateIntent("rejected")).toBe("danger");
    expect(taskStateIntent("stalled")).toBe("danger");
  });
  it("maps waiting states to warning", () => {
    expect(taskStateIntent("input-required")).toBe("warning");
    expect(taskStateIntent("auth-required")).toBe("warning");
  });
  it("maps active states to accent", () => {
    expect(taskStateIntent("working")).toBe("accent");
    expect(taskStateIntent("submitted")).toBe("accent");
  });
  it("maps quiescent states to neutral", () => {
    expect(taskStateIntent("canceled")).toBe("neutral");
    expect(taskStateIntent("paused-for-upgrade")).toBe("neutral");
  });
});

describe("isTaskInFlight", () => {
  it("is true for in-flight states", () => {
    expect(isTaskInFlight("submitted")).toBe(true);
    expect(isTaskInFlight("working")).toBe(true);
    expect(isTaskInFlight("input-required")).toBe(true);
    expect(isTaskInFlight("auth-required")).toBe(true);
  });
  it("is false for terminal/quiescent states", () => {
    expect(isTaskInFlight("completed")).toBe(false);
    expect(isTaskInFlight("failed")).toBe(false);
    expect(isTaskInFlight("canceled")).toBe(false);
    expect(isTaskInFlight("archived")).toBe(false);
    expect(isTaskInFlight("stalled")).toBe(false);
  });
});
