# OpenAI-compatible Chatterbox TTS host sidecar for DPF on Apple Silicon.
#
# Endpoints:
#   GET  /                        health check
#   GET  /v1/models               OpenAI model list
#   POST /v1/audio/speech         one-shot WAV
#   POST /v1/audio/speech/stream  sentence-level streaming (low latency)
#     Response: application/octet-stream
#     Each chunk: 4-byte big-endian uint32 length + complete WAV bytes
#     Time-to-first-audio approx 1-2s regardless of total text length.
#
# Spec: docs/superpowers/specs/2026-05-28-tts-apple-silicon-local-design.md
import io, os, re, shutil, struct, subprocess, tempfile, time, wave
from typing import AsyncGenerator
import numpy as np, torch
import torchaudio as ta  # noqa: F401
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from chatterbox.tts import ChatterboxTTS

DEVICE = os.environ.get("DPF_CB_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cpu")
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
MIN_SENTENCE_CHARS = 12


def _envf(key, default):
    try: return float(os.environ.get(key, default))
    except: return default

def _clamp(v, lo, hi): return max(lo, min(hi, v))

_REF_ROOT = os.environ.get("DPF_TTS_REFERENCE_HOST_ROOT") or ""

def _safe_ref_path(ref):
    if not _REF_ROOT: raise ValueError("DPF_TTS_REFERENCE_HOST_ROOT not set")
    root = os.path.realpath(_REF_ROOT)
    rel = ref
    if os.path.isabs(ref):
        norm = os.path.normpath(ref)
        if norm != root and not norm.startswith(root + os.sep): raise ValueError("path outside root")
        rel = norm[len(root):]
    parts = [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts): raise ValueError("invalid path")
    safe = root
    for want in parts:
        try: entries = os.listdir(safe)
        except OSError: raise ValueError("dir not found")
        if want not in entries: raise ValueError("path not found")
        safe = os.path.join(safe, entries[entries.index(want)])
    if not os.path.isfile(safe): raise ValueError("not a file")
    return safe

print(f"[chatterbox] loading on {DEVICE} ...", flush=True)
_t0 = time.time()
MODEL = ChatterboxTTS.from_pretrained(device=DEVICE)
print(f"[chatterbox] loaded {time.time()-_t0:.1f}s sr={MODEL.sr} ffmpeg={FFMPEG} device={DEVICE}", flush=True)

app = FastAPI()


@app.get("/")
def root():
    return {"status": "ok", "model": "chatterbox", "device": DEVICE}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "chatterbox", "object": "model"}]}


def _decode_ref(path):
    if path.lower().endswith((".wav", ".flac", ".mp3")): return path, None
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    subprocess.run([FFMPEG, "-v", "error", "-i", path, "-ar", "24000", "-ac", "1", tmp, "-y"], check=True)
    return tmp, tmp


def _to_wav(wav_tensor, speed):
    arr = np.clip(wav_tensor.squeeze(0).cpu().numpy(), -1.0, 1.0)
    pcm = (arr * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(MODEL.sr); w.writeframes(pcm)
    data = buf.getvalue()
    if abs(speed - 1.0) > 0.01:
        src = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
        dst = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
        try:
            open(src, "wb").write(data)
            subprocess.run([FFMPEG, "-v", "error", "-i", src, "-filter:a", f"atempo={speed}", dst, "-y"], check=True)
            data = open(dst, "rb").read()
        finally:
            for f in (src, dst):
                try: os.unlink(f)
                except: pass
    return data


def _split_sentences(text):
    raw = re.split(r"(?<=[.!?])\s+", text.strip())
    merged, carry = [], ""
    for s in raw:
        carry = (carry + " " + s).strip() if carry else s
        if len(carry) >= MIN_SENTENCE_CHARS:
            merged.append(carry); carry = ""
    if carry:
        if merged: merged[-1] = merged[-1] + " " + carry
        else: merged.append(carry)
    return merged or [text]


def _params(body):
    ex  = _clamp(float(body.get("exaggeration", _envf("DPF_CB_EXAGGERATION", 0.5))), 0.25, 1.0)
    cfg = _clamp(float(body.get("cfg_weight",   _envf("DPF_CB_CFG_WEIGHT",   0.5))), 0.2,  1.0)
    tmp = _clamp(float(body.get("temperature",  _envf("DPF_CB_TEMPERATURE",  0.8))), 0.2,  1.2)
    spd = _clamp(float(body.get("speed",        _envf("DPF_CB_SPEED",        1.0))), 0.5,  2.0)
    return ex, cfg, tmp, spd


def _resolve_ref(body):
    ref = body.get("ref_audio")
    if not ref: return None, None
    safe = _safe_ref_path(ref)
    return _decode_ref(safe)


def _make_kw(decoded_ref, ex, cfg, tmp):
    kw = {"exaggeration": ex, "cfg_weight": cfg, "temperature": tmp}
    if decoded_ref: kw["audio_prompt_path"] = decoded_ref
    return kw


@app.post("/v1/audio/speech")
async def speech(req: Request):
    body = await req.json()
    text = (body.get("input") or "").strip()
    if not text: return JSONResponse({"error": "input required"}, status_code=400)
    try: decoded_ref, cleanup = _resolve_ref(body)
    except ValueError: return JSONResponse({"error": "invalid reference audio"}, status_code=400)
    ex, cfg, tmp, spd = _params(body)
    kw = _make_kw(decoded_ref, ex, cfg, tmp)
    t0 = time.time()
    try:
        wav = MODEL.generate(text, **kw)
    except Exception as exc:
        print(f"[chatterbox] failed: {exc}", flush=True)
        return JSONResponse({"error": "synthesis failed"}, status_code=502)
    finally:
        if cleanup:
            try: os.unlink(cleanup)
            except: pass
    data = _to_wav(wav, spd)
    print(f"[chatterbox] gen={time.time()-t0:.1f}s ex={ex} cfg={cfg} temp={tmp} spd={spd} words={len(text.split())}", flush=True)
    return Response(content=data, media_type="audio/wav")


@app.post("/v1/audio/speech/stream")
async def speech_stream(req: Request):
    """Sentence-level streaming. Response: [4B uint32 len][WAV] repeated.
    X-Sentence-Count header = number of chunks. Time-to-first-audio approx 1-2s."""
    body = await req.json()
    text = (body.get("input") or "").strip()
    if not text: return JSONResponse({"error": "input required"}, status_code=400)
    try: decoded_ref, cleanup = _resolve_ref(body)
    except ValueError: return JSONResponse({"error": "invalid reference audio"}, status_code=400)
    ex, cfg, tmp, spd = _params(body)
    sentences = _split_sentences(text)
    kw_base = _make_kw(decoded_ref, ex, cfg, tmp)
    print(f"[chatterbox/stream] {len(sentences)} sentences ex={ex} cfg={cfg} spd={spd}", flush=True)

    async def _gen() -> AsyncGenerator[bytes, None]:
        ref_cleanup = cleanup
        try:
            for i, sentence in enumerate(sentences):
                t0 = time.time()
                try:
                    wav = MODEL.generate(sentence, **kw_base)
                except Exception as exc:
                    print(f"[chatterbox/stream] sentence {i} failed: {exc}", flush=True)
                    continue
                data = _to_wav(wav, spd)
                dur = wav.shape[-1] / MODEL.sr
                print(f"[chatterbox/stream] {i+1}/{len(sentences)} gen={time.time()-t0:.1f}s audio={dur:.1f}s", flush=True)
                yield struct.pack(">I", len(data)) + data
        finally:
            if ref_cleanup:
                try: os.unlink(ref_cleanup)
                except: pass

    return StreamingResponse(_gen(), media_type="application/octet-stream",
                             headers={"X-Sentence-Count": str(len(sentences))})
