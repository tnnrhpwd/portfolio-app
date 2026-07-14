"""
voice_pipeline.py — CSimple Voice Input/Output Service

Runs as a long-lived subprocess managed by audio-stream-manager.js.
Communicates via JSON lines on stdin/stdout.

Commands (stdin, one JSON object per line):
  {"cmd": "status"}
  {"cmd": "listen", "max_seconds": 10, "silence_ms": 800}
  {"cmd": "stop_listen"}
  {"cmd": "speak", "text": "Hello world", "rate": 175, "volume": 1.0}
  {"cmd": "list_devices"}
  {"cmd": "set_device", "index": 0}
  {"cmd": "set_model", "size": "tiny"}   # tiny | base | small | medium
  {"cmd": "quit"}

Responses (stdout, one JSON object per line):
  {"type": "ready", "devices": [...], "model": "tiny"}
  {"type": "level", "rms": 0.02, "speaking": false}    # emitted ~10x/s during listen
  {"type": "transcript", "text": "...", "confidence": 0.9, "duration_s": 1.4}
  {"type": "wakeword", "phrase": "hey csimple"}
  {"type": "speak_done"}
  {"type": "error", "message": "..."}
  {"type": "devices", "devices": [...]}
  {"type": "stopped"}

Safety: audio frames are processed entirely in local RAM; nothing is written to
disk or sent to a remote server. The Whisper model runs fully offline.
"""

import sys
import json
import threading
import time
import queue
import math
import numpy as np
import os

# ─── Lazy imports ──────────────────────────────────────────────────────────────
# We import heavy deps lazily so the process starts fast and any missing-dep
# errors surface clearly as JSON error messages rather than tracebacks.

def _emit(obj):
    """Write a JSON object to stdout and flush immediately."""
    try:
        print(json.dumps(obj), flush=True)
    except Exception:
        pass

def _log_err(msg):
    _emit({"type": "error", "message": str(msg)})

# ─── Device discovery ─────────────────────────────────────────────────────────

def list_audio_devices():
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        out = []
        for i, d in enumerate(devices):
            if d['max_input_channels'] > 0:
                out.append({
                    "index": i,
                    "name": d['name'],
                    "channels": d['max_input_channels'],
                    "sample_rate": int(d['default_samplerate']),
                    "is_default": (i == sd.default.device[0]),
                })
        return out
    except Exception as e:
        return [{"error": str(e)}]

# ─── Wakeword detection ───────────────────────────────────────────────────────

WAKEWORDS = ["hey csimple", "hey simple", "hey c simple", "csimple"]

def _detect_wakeword(text):
    t = text.strip().lower()
    for w in WAKEWORDS:
        if t.startswith(w) or t == w:
            remainder = t[len(w):].strip(" ,.!?")
            return True, remainder
    return False, text

# ─── STT Engine ───────────────────────────────────────────────────────────────

class WhisperEngine:
    def __init__(self, model_size="tiny"):
        self._model_size = model_size
        self._model = None
        self._lock = threading.Lock()

    def _ensure_loaded(self):
        if self._model is not None:
            return
        try:
            import whisper
            self._model = whisper.load_model(self._model_size)
        except ImportError:
            raise RuntimeError(
                "openai-whisper is not installed. Run: pip install openai-whisper"
            )

    def transcribe(self, audio_np, sample_rate=16000):
        """
        Transcribe a numpy float32 array (already at 16kHz, mono).
        Returns {"text": str, "confidence": float, "language": str}.
        """
        with self._lock:
            self._ensure_loaded()
            import whisper
            # Whisper expects mono 16kHz float32
            if audio_np.dtype != np.float32:
                audio_np = audio_np.astype(np.float32)
            if audio_np.ndim > 1:
                audio_np = audio_np.mean(axis=1)
            # Pad/trim to 30s as Whisper expects
            audio_np = whisper.pad_or_trim(audio_np)
            mel = whisper.log_mel_spectrogram(audio_np).to(self._model.device)
            options = whisper.DecodingOptions(fp16=False)
            result = whisper.decode(self._model, mel, options)
            text = result.text.strip()
            # avg_logprob is in [-inf, 0]; map to [0, 1]
            confidence = float(np.exp(result.avg_logprob)) if hasattr(result, 'avg_logprob') else 0.8
            return {"text": text, "confidence": min(1.0, max(0.0, confidence)), "language": getattr(result, 'language', 'en')}

    def set_model(self, size):
        with self._lock:
            if size != self._model_size:
                self._model_size = size
                self._model = None  # force reload

# ─── TTS Engine ───────────────────────────────────────────────────────────────

class TTSEngine:
    def __init__(self):
        self._engine = None
        self._lock = threading.Lock()

    def _ensure_loaded(self):
        if self._engine is not None:
            return
        try:
            import pyttsx3
            self._engine = pyttsx3.init()
        except ImportError:
            raise RuntimeError("pyttsx3 is not installed. Run: pip install pyttsx3")

    def speak(self, text, rate=175, volume=1.0):
        with self._lock:
            self._ensure_loaded()
            self._engine.setProperty('rate', int(rate))
            self._engine.setProperty('volume', float(volume))
            self._engine.say(text)
            self._engine.runAndWait()

# ─── Audio Listener ───────────────────────────────────────────────────────────

SAMPLE_RATE = 16000
CHUNK_FRAMES = 1600   # 100ms chunks

class AudioListener:
    """
    Records microphone audio until silence is detected or max_seconds reached.
    Emits level updates on a callback. Returns numpy float32 array.
    """
    def __init__(self, device_index=None):
        self._device_index = device_index
        self._stop_event = threading.Event()

    def set_device(self, index):
        self._device_index = index

    def stop(self):
        self._stop_event.set()

    def record(self, max_seconds=10, silence_ms=800, level_callback=None):
        """
        Record until silence for `silence_ms` ms or `max_seconds` elapsed.
        `level_callback(rms, speaking)` called ~10x/s.
        Returns (frames_np, duration_s).
        """
        try:
            import sounddevice as sd
        except ImportError:
            raise RuntimeError("sounddevice is not installed. Run: pip install sounddevice")

        self._stop_event.clear()
        frames = []
        silence_threshold = 0.01  # RMS threshold for silence
        silence_chunks_needed = max(1, int(silence_ms / 100))
        silence_count = 0
        max_chunks = int(max_seconds * 10)  # at 100ms each
        chunk_count = 0

        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype='float32',
            blocksize=CHUNK_FRAMES,
            device=self._device_index,
        ) as stream:
            while chunk_count < max_chunks and not self._stop_event.is_set():
                chunk, overflowed = stream.read(CHUNK_FRAMES)
                chunk_np = chunk[:, 0] if chunk.ndim > 1 else chunk
                frames.append(chunk_np.copy())
                rms = float(np.sqrt(np.mean(chunk_np ** 2)))
                speaking = rms > silence_threshold
                if level_callback:
                    try:
                        level_callback(rms, speaking)
                    except Exception:
                        pass
                if speaking:
                    silence_count = 0
                else:
                    silence_count += 1
                    if silence_count >= silence_chunks_needed and len(frames) > silence_chunks_needed + 2:
                        # Enough audio collected + trailing silence
                        break
                chunk_count += 1

        if not frames:
            return np.zeros(0, dtype=np.float32), 0.0
        audio = np.concatenate(frames)
        duration_s = len(audio) / SAMPLE_RATE
        return audio, duration_s

# ─── Main service loop ────────────────────────────────────────────────────────

def main():
    stt = WhisperEngine(model_size="tiny")
    tts = TTSEngine()
    listener = AudioListener()
    listen_thread = None
    _stop_listen = threading.Event()

    def _do_listen(max_seconds, silence_ms):
        try:
            def on_level(rms, speaking):
                _emit({"type": "level", "rms": round(rms, 5), "speaking": speaking})

            audio, duration_s = listener.record(
                max_seconds=max_seconds,
                silence_ms=silence_ms,
                level_callback=on_level,
            )
            if audio is None or len(audio) < SAMPLE_RATE * 0.3:
                _emit({"type": "transcript", "text": "", "confidence": 0.0, "duration_s": round(duration_s, 2)})
                return

            result = stt.transcribe(audio, sample_rate=SAMPLE_RATE)
            text = result["text"]
            is_wake, remainder = _detect_wakeword(text)
            if is_wake:
                _emit({"type": "wakeword", "phrase": text[:50], "remainder": remainder})
            _emit({
                "type": "transcript",
                "text": text,
                "remainder": remainder if is_wake else text,
                "confidence": result["confidence"],
                "language": result["language"],
                "duration_s": round(duration_s, 2),
                "wakeword_detected": is_wake,
            })
        except Exception as e:
            _emit({"type": "error", "message": f"listen failed: {e}"})

    devices = list_audio_devices()
    _emit({"type": "ready", "devices": devices, "model": "tiny"})

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            cmd_obj = json.loads(raw_line)
        except json.JSONDecodeError as e:
            _log_err(f"bad JSON: {e}")
            continue

        cmd = cmd_obj.get("cmd", "")

        if cmd == "quit":
            _emit({"type": "stopped"})
            break

        elif cmd == "status":
            _emit({
                "type": "status",
                "listening": listen_thread is not None and listen_thread.is_alive(),
                "model": stt._model_size,
                "device": listener._device_index,
            })

        elif cmd == "list_devices":
            _emit({"type": "devices", "devices": list_audio_devices()})

        elif cmd == "set_device":
            idx = cmd_obj.get("index")
            listener.set_device(idx)
            _emit({"type": "ok", "device": idx})

        elif cmd == "set_model":
            size = cmd_obj.get("size", "tiny")
            if size not in ("tiny", "base", "small", "medium", "large"):
                _log_err(f"unknown model size: {size}")
            else:
                stt.set_model(size)
                _emit({"type": "ok", "model": size})

        elif cmd == "listen":
            if listen_thread and listen_thread.is_alive():
                _log_err("already listening")
                continue
            max_sec = min(float(cmd_obj.get("max_seconds", 10)), 120)
            silence_ms = min(int(cmd_obj.get("silence_ms", 800)), 5000)
            listen_thread = threading.Thread(
                target=_do_listen,
                args=(max_sec, silence_ms),
                daemon=True,
            )
            listen_thread.start()
            _emit({"type": "ok", "listening": True, "max_seconds": max_sec})

        elif cmd == "stop_listen":
            listener.stop()
            _emit({"type": "ok", "listening": False})

        elif cmd == "speak":
            text = str(cmd_obj.get("text", "")).strip()
            if not text:
                _log_err("speak requires text")
                continue
            rate = int(cmd_obj.get("rate", 175))
            volume = float(cmd_obj.get("volume", 1.0))
            # Speak in a thread so we don't block stdin reading
            def _speak():
                try:
                    tts.speak(text, rate=rate, volume=volume)
                    _emit({"type": "speak_done"})
                except Exception as e:
                    _log_err(f"speak failed: {e}")
            threading.Thread(target=_speak, daemon=True).start()

        else:
            _log_err(f"unknown command: {cmd}")

if __name__ == "__main__":
    main()
