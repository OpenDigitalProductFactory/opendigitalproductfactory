import re

MIN_SENTENCE_CHARS = 12
MAX_SENTENCE_CHARS = 220

_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")
_SOFT_BOUNDARY = re.compile(r"(?<=[,;:])\s+")
_BULLET_PREFIX = re.compile(r"^\s*(?:[-*]|\d+[.)])\s+")


def _split_long_segment(segment):
    if len(segment) <= MAX_SENTENCE_CHARS:
        return [segment]

    chunks, carry = [], ""
    for part in _SOFT_BOUNDARY.split(segment):
        part = part.strip()
        if not part:
            continue
        candidate = f"{carry} {part}".strip() if carry else part
        if len(candidate) <= MAX_SENTENCE_CHARS:
            carry = candidate
            continue
        if carry:
            chunks.append(carry)
        while len(part) > MAX_SENTENCE_CHARS:
            split_at = part.rfind(" ", 0, MAX_SENTENCE_CHARS + 1)
            if split_at < MIN_SENTENCE_CHARS:
                split_at = MAX_SENTENCE_CHARS
            chunks.append(part[:split_at].strip())
            part = part[split_at:].strip()
        carry = part
    if carry:
        chunks.append(carry)
    return chunks


def split_speech_chunks(text):
    """Split prose, headings, and newline lists into bounded TTS chunks."""
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    segments = []
    for line in normalized.split("\n"):
        line = _BULLET_PREFIX.sub("", line).strip()
        if not line:
            continue
        for part in _SENTENCE_BOUNDARY.split(line):
            part = part.strip()
            if part:
                segments.extend(_split_long_segment(part))

    merged, carry = [], ""
    for segment in segments:
        candidate = f"{carry} {segment}".strip() if carry else segment
        if len(candidate) < MIN_SENTENCE_CHARS:
            carry = candidate
            continue
        if carry and len(candidate) <= MAX_SENTENCE_CHARS:
            merged.append(candidate)
        else:
            if carry:
                merged.append(carry)
            merged.append(segment)
        carry = ""

    if carry:
        if merged and len(f"{merged[-1]} {carry}") <= MAX_SENTENCE_CHARS:
            merged[-1] = f"{merged[-1]} {carry}"
        else:
            merged.append(carry)

    return merged or [normalized]
