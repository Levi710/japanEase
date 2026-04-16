import asyncio
import os
import re
import shutil
import tempfile
from typing import Any, Dict, Iterable, List, Optional, Tuple

from dotenv import load_dotenv

load_dotenv()

model_size = os.getenv("WHISPER_MODEL", "small")
device = os.getenv("WHISPER_DEVICE", "cpu")
compute_type = os.getenv("WHISPER_COMPUTE", "int8")

LINE_BREAK_PUNCTUATION = ("。", "！", "?", "？", "!", ".", "…")
LINE_GAP_SECONDS = float(os.getenv("WHISPER_LINE_GAP_SECONDS", "0.85"))
MAX_LINE_DURATION_SECONDS = float(os.getenv("WHISPER_MAX_LINE_DURATION_SECONDS", "6.0"))
MAX_LINE_WORDS = int(os.getenv("WHISPER_MAX_LINE_WORDS", "12"))

model = None


def get_model():
    """Initialize Whisper lazily so imports stay lightweight and testable."""
    global model
    if model is None:
        from faster_whisper import WhisperModel

        print(f"Loading Whisper {model_size} on {device} ({compute_type})...")
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
    return model


def _clean_transcript_text(text: Optional[str]) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    cleaned = cleaned.strip(" '\"“”‘’")
    return cleaned


def _needs_ascii_copy(path: str) -> bool:
    try:
        path.encode("ascii")
        return False
    except UnicodeEncodeError:
        return True


def _copy_to_ascii_temp_path(path: str) -> Optional[str]:
    if not _needs_ascii_copy(path):
        return None

    suffix = os.path.splitext(path)[1] or ".bin"
    fd, temp_path = tempfile.mkstemp(prefix="whisper_input_", suffix=suffix)
    os.close(fd)
    shutil.copy2(path, temp_path)
    return temp_path


def _finalize_line(words: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    text = _clean_transcript_text("".join(word["raw"] for word in words))
    if not text:
        return None

    return {
        "start": words[0]["start"],
        "end": words[-1]["end"],
        "text": text,
    }


def _split_segment_into_lines(segment: Any) -> List[Dict[str, Any]]:
    segment_text = _clean_transcript_text(getattr(segment, "text", ""))
    words = getattr(segment, "words", None) or []

    timed_words: List[Dict[str, Any]] = []
    for word in words:
        start = getattr(word, "start", None)
        end = getattr(word, "end", None)
        raw = getattr(word, "word", "")
        if start is None or end is None or not _clean_transcript_text(raw):
            continue
        timed_words.append({"start": float(start), "end": float(end), "raw": raw})

    if not timed_words:
        if not segment_text:
            return []
        return [
            {
                "start": float(getattr(segment, "start", 0.0)),
                "end": float(getattr(segment, "end", 0.0)),
                "text": segment_text,
            }
        ]

    lines: List[Dict[str, Any]] = []
    current_words = [timed_words[0]]

    for word in timed_words[1:]:
        prev_word = current_words[-1]
        gap = word["start"] - prev_word["end"]
        current_duration = prev_word["end"] - current_words[0]["start"]
        prev_text = _clean_transcript_text(prev_word["raw"])

        should_split = (
            gap >= LINE_GAP_SECONDS
            or prev_text.endswith(LINE_BREAK_PUNCTUATION)
            or (len(current_words) >= MAX_LINE_WORDS and gap >= 0.25)
            or (current_duration >= MAX_LINE_DURATION_SECONDS and gap >= 0.15)
        )

        if should_split:
            finalized = _finalize_line(current_words)
            if finalized:
                lines.append(finalized)
            current_words = [word]
        else:
            current_words.append(word)

    finalized = _finalize_line(current_words)
    if finalized:
        lines.append(finalized)

    return lines


def split_transcript_lines(segments: Iterable[Any]) -> List[Dict[str, Any]]:
    """Convert raw Whisper segments into line-sized subtitle segments."""
    split_segments: List[Dict[str, Any]] = []

    for segment in segments:
        split_segments.extend(_split_segment_into_lines(segment))

    return split_segments


def _build_transcribe_options() -> Dict[str, Any]:
    return {
        "beam_size": 5,
        "language": "ja",
        "vad_filter": True,
        "vad_parameters": dict(
            min_silence_duration_ms=1000,
            speech_pad_ms=800,
            threshold=0.20,
        ),
        "no_speech_threshold": 0.1,
        "log_prob_threshold": -1.2,
        "compression_ratio_threshold": 2.4,
        "condition_on_previous_text": True,
        "word_timestamps": True,
    }


def _transcribe_media(video_path: str) -> Tuple[List[Dict[str, Any]], float]:
    working_copy = _copy_to_ascii_temp_path(video_path)
    source_path = working_copy or video_path

    try:
        raw_segments, info = get_model().transcribe(source_path, **_build_transcribe_options())
        split_segments = split_transcript_lines(list(raw_segments))
        return split_segments, float(info.duration)
    finally:
        if working_copy and os.path.exists(working_copy):
            os.remove(working_copy)


async def transcribe_video_stream(video_path: str, chunk_size: int = 5):
    """Transcribe the uploaded video and yield line-sized subtitle chunks."""
    loop = asyncio.get_running_loop()
    segments, duration = await loop.run_in_executor(None, lambda: _transcribe_media(video_path))

    for index in range(0, len(segments), chunk_size):
        yield (segments[index:index + chunk_size], duration)
