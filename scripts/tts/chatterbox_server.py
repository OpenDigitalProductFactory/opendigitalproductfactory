# OpenAI-compatible Chatterbox TTS host sidecar for DPF on Apple Silicon.
#
# Why this exists: Docker Desktop on macOS has no Metal GPU passthrough, so a
# cloning-grade neural TTS model must run as a native host process. This serves
# Resemble AI's Chatterbox (MIT code + weights) over an OpenAI-compatible
# endpoint the DPF portal already speaks, reached via host.docker.internal.
#
# Endpoints:
#   GET  /                 -> {status, model, device}      (health)
#   GET  /v1/models        -> OpenAI-style model list
#   POST /v1/audio/speech  -> audio/wav bytes
#     body: {input, ref_audio?, response_format?,
#            exaggeration?, cfg_weight?, temperature?, speed?}
#
# Per-profile tuning (request value wins over env default):
#   exaggeration  expressiveness / enthusiasm    env DPF_CB_EXAGGERATION (0.5)
#   cfg_weight    lower = faster, looser pacing   env DPF_CB_CFG_WEIGHT   (0.5)
#   temperature   variability                     env DPF_CB_TEMPERATURE  (0.8)
#   speed         post-process tempo (atempo)     env DPF_CB_SPEED        (1.0)
#
# Spec: docs/superpowers/specs/2026-05-28-tts-apple-silicon-local-design.md
import io
import os
import shutil
import subprocess
import tempfile
import time
import wave

import numpy as np
import torch
import torchaudio as ta  # noqa: F401  (ensures torchaudio backend is initialised)
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from chatterbox.tts import ChatterboxTTS

DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
# Resolve ffmpeg from PATH (launchd prepends Homebrew via the launch script);
# fall back to the common Homebrew location.
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"


def _envf(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# Reference clips must live under this root (the host side of the portal's voice
# storage). Constraining ref_audio to it prevents path traversal — an attacker
# can't make the server read arbitrary files like /etc/passwd. When unset, no
# reference cloning is allowed (the request must omit ref_audio).
_REF_ROOT = os.environ.get("DPF_TTS_REFERENCE_HOST_ROOT") or ""


def _safe_ref_path(ref: str) -> str:
    """Resolve `ref` and confirm it stays within _REF_ROOT. Raises ValueError on
    an unconfigured root or any path that escapes it (CWE-22 path injection)."""
    if not _REF_ROOT:
        raise ValueError("reference cloning disabled: DPF_TTS_REFERENCE_HOST_ROOT not set")
    root = os.path.realpath(_REF_ROOT)
    resolved = os.path.realpath(os.path.join(root, ref))
    # Containment check: resolved must be root itself or a descendant.
    if resolved != root and not resolved.startswith(root + os.sep):
        raise ValueError("reference path escapes the allowed root")
    if not os.path.isfile(resolved):
        raise ValueError("reference file not found")
    return resolved


print(f"[chatterbox] loading on {DEVICE} ...", flush=True)
_t0 = time.time()
MODEL = ChatterboxTTS.from_pretrained(device=DEVICE)
print(
    f"[chatterbox] loaded {time.time() - _t0:.1f}s sr={MODEL.sr} ffmpeg={FFMPEG} "
    f"defaults ex={_envf('DPF_CB_EXAGGERATION', 0.5)} cfg={_envf('DPF_CB_CFG_WEIGHT', 0.5)} "
    f"temp={_envf('DPF_CB_TEMPERATURE', 0.8)} speed={_envf('DPF_CB_SPEED', 1.0)}",
    flush=True,
)

app = FastAPI()


@app.get("/")
def root():
    return {"status": "ok", "model": "chatterbox", "device": DEVICE}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "chatterbox", "object": "model"}]}


def _decode_to_wav(path: str):
    """Chatterbox/torchaudio cannot read webm/opus; transcode non-WAV refs to a
    temp 24 kHz mono wav. Returns (path_to_use, temp_to_cleanup_or_None)."""
    if path.lower().endswith((".wav", ".flac", ".mp3")):
        return path, None
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    subprocess.run(
        [FFMPEG, "-v", "error", "-i", path, "-ar", "24000", "-ac", "1", tmp, "-y"],
        check=True,
    )
    return tmp, tmp


def _apply_tempo(wav_bytes: bytes, speed: float) -> bytes:
    if abs(speed - 1.0) <= 0.01:
        return wav_bytes
    src = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    dst = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    try:
        with open(src, "wb") as f:
            f.write(wav_bytes)
        subprocess.run(
            [FFMPEG, "-v", "error", "-i", src, "-filter:a", f"atempo={speed}", dst, "-y"],
            check=True,
        )
        with open(dst, "rb") as f:
            return f.read()
    finally:
        for f in (src, dst):
            try:
                os.unlink(f)
            except OSError:
                pass


@app.post("/v1/audio/speech")
async def speech(req: Request):
    body = await req.json()
    text = (body.get("input") or "").strip()
    if not text:
        return JSONResponse({"error": "input is required"}, status_code=400)

    ref = body.get("ref_audio")
    exaggeration = _clamp(float(body.get("exaggeration", _envf("DPF_CB_EXAGGERATION", 0.5))), 0.25, 1.0)
    cfg_weight = _clamp(float(body.get("cfg_weight", _envf("DPF_CB_CFG_WEIGHT", 0.5))), 0.2, 1.0)
    temperature = _clamp(float(body.get("temperature", _envf("DPF_CB_TEMPERATURE", 0.8))), 0.2, 1.2)
    speed = _clamp(float(body.get("speed", _envf("DPF_CB_SPEED", 1.0))), 0.5, 2.0)

    # Validate the reference path up front (path-injection guard). A bad/escaping
    # path is a client error, not a server failure.
    safe_ref = None
    if ref:
        try:
            safe_ref = _safe_ref_path(ref)
        except ValueError:
            return JSONResponse({"error": "invalid reference audio"}, status_code=400)

    cleanup = None
    t0 = time.time()
    try:
        kwargs = {"exaggeration": exaggeration, "cfg_weight": cfg_weight, "temperature": temperature}
        if safe_ref:
            ref_path, cleanup = _decode_to_wav(safe_ref)
            kwargs["audio_prompt_path"] = ref_path
        wav = MODEL.generate(text, **kwargs)
    except Exception as exc:  # noqa: BLE001
        # Log the detail server-side; return a generic message so internal
        # details / stack traces are not exposed to the caller (CWE-209).
        print(f"[chatterbox] generate failed: {exc}", flush=True)
        return JSONResponse({"error": "synthesis failed"}, status_code=502)
    finally:
        if cleanup:
            try:
                os.unlink(cleanup)
            except OSError:
                pass

    arr = np.clip(wav.squeeze(0).cpu().numpy(), -1.0, 1.0)
    pcm = (arr * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(MODEL.sr)
        w.writeframes(pcm)
    data = _apply_tempo(buf.getvalue(), speed)

    print(
        f"[chatterbox] gen={time.time() - t0:.1f}s ex={exaggeration} cfg={cfg_weight} "
        f"temp={temperature} speed={speed} words={len(text.split())}",
        flush=True,
    )
    return Response(content=data, media_type="audio/wav")
