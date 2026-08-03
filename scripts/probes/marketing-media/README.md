# Marketing media evaluation probes

This folder contains synthetic, non-customer evaluation inputs for `BI-0C891AC7`.

- `composition/index.html` is a 50-second, 1920×1080, captions-on HyperFrames composition with exact locked browser dependencies and no customer media. The image stages those dependencies beside a temporary composition copy; the probe container has no network.
- `run-local-render.mjs` runs HyperFrames lint, browser validation, and layout inspection; renders twice; fingerprints the exact executables and FFmpeg build configuration; and writes a machine-readable determinism receipt.

`Dockerfile.probe` is the evaluated provisioning path. It pins the Node base image by amd64 manifest digest and installs exact HyperFrames, FFmpeg, and FFprobe packages from `pnpm-lock.yaml`; the resulting receipt fingerprints the resolved executables. Build and run it only while holding the governed `local-integration-ci` lease.

`run-container-probe.mjs` is the bounded gate command: it builds that image, renders offline with 4 CPUs and 8 GiB of memory, removes the transient container, and adds the image identity to the receipt.

Generated MP4 files stay untracked. The JSON receipt is reviewable evidence and may be committed after the run.

## Gemini TTS

`run-gemini-tts-probe.mjs` remains blocked unless a governed `GEMINI_API_KEY`
and `DPF_GEMINI_PAID_TIER_CONFIRMED=1` are both present, preventing accidental
paid processing during routine verification. Provider responses cross a
hostile-data boundary before becoming local artifacts: the probe bounds the
response and decoded audio, accepts only WAV or Gemini's 24 kHz linear PCM
format, validates the declared media shape, and allowlists receipt counters
instead of persisting raw provider metadata or errors.
