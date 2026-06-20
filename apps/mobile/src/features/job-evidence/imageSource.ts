/**
 * Pluggable image-source for the job-completion evidence flow.
 *
 * The mobile shell needs to capture a photo, but we want the capture step
 * to be a *seam* — easy to swap (today: a stub that returns a synthetic
 * placeholder; tomorrow: expo-image-picker / expo-camera) and easy to test
 * (the store mocks this module, not a native module).
 */

export interface CapturedImage {
  uri: string;
  mimeType: string;
  /** Best-effort filename when the picker can supply one. */
  fileName?: string;
}

/** A function the store calls to obtain a freshly-captured image. */
export type ImageCaptureFn = () => Promise<CapturedImage | null>;

/**
 * Default capture stub. Returns a deterministic placeholder URI so the
 * downstream upload pipeline still gets a well-formed payload to push at
 * the API; the real capture primitive lands in a follow-up slice that
 * adds expo-image-picker to the mobile package.
 *
 * The placeholder is intentionally a `data:` URL so the upload layer (which
 * builds a multipart body from it) treats it like any other source.
 */
export const stubCapture: ImageCaptureFn = async () => {
  // 1x1 transparent PNG — small enough that the upload pipeline exercises
  // the real path without bloating tests.
  return {
    uri:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    mimeType: "image/png",
    fileName: "completion-photo.png",
  };
};

let active: ImageCaptureFn = stubCapture;

/** Get the currently-active capture function (used by the store). */
export function getImageCapture(): ImageCaptureFn {
  return active;
}

/** Replace the active capture function (used by tests + the future real picker). */
export function setImageCapture(fn: ImageCaptureFn): void {
  active = fn;
}

/** Test-only: restore the default stub. */
export function __resetImageCaptureForTests(): void {
  active = stubCapture;
}
