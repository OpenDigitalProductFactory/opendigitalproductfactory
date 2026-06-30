// Test setup for golden-triangle component tests.
// Loads @testing-library/jest-dom matchers into Vitest's `expect`.
// Activated per-file via `import "./test-setup"`.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, vi } from "vitest";

const originalGetContext = HTMLCanvasElement.prototype.getContext;

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  clearRect: vi.fn(),
  createImageData: vi.fn((width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  })),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  fill: vi.fn(),
  fillRect: vi.fn(),
  putImageData: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
})) as unknown as HTMLCanvasElement["getContext"];

// Vitest runs with `globals: false`, so testing-library's auto-cleanup does not
// fire on its own — wire it up explicitly.
afterEach(() => {
  cleanup();
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});
