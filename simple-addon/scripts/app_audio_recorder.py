"""
app_audio_recorder.py — Application/system audio (WASAPI loopback) recorder.

Long-lived subprocess managed by server/app-audio-manager.js.
Communicates via JSON lines on stdin/stdout.

Commands (stdin, one JSON object per line):
  {"cmd": "status"}
  {"cmd": "start"}                    # begin capturing the system output mix
  {"cmd": "stop"}                     # finalize the capture + report
  {"cmd": "list_outputs"}             # enumerate output devices (loopback sources)
  {"cmd": "quit"}

Responses (stdout, one JSON object per line):
  {"type": "ready"}
  {"type": "ok", "recording": true}
  {"type": "level", "rms": 1234.5}    # int16 RMS, emitted while recording
  {"type": "stopped", "file": "<tmp .pcm path>", "sample_rate": 48000,
   "channels": 2, "bytes": 123456, "duration_s": 3.2}
  {"type": "status", "recording": false, ...}
  {"type": "outputs", "outputs": [...]}
  {"type": "error", "message": "..."}

The capture is written as raw interleaved int16 PCM to a temp file. The Node
manager reads that file and encodes it to MP3 (lamejs) — no ffmpeg required.
"""

import sys
import json
import os
import threading
import tempfile

import numpy as np
import soundcard as sc


def _emit(obj):
    try:
        print(json.dumps(obj), flush=True)
    except Exception:
        pass


def _log_err(msg):
    _emit({"type": "error", "message": str(msg)})


# ─── Shared recording state (GIL makes these simple reads/writes safe) ───────

_rec = {
    "recording": False,
    "file": None,
    "sample_rate": 0,
    "channels": 2,
    "bytes": 0,
    "duration_s": 0.0,
    "level": 0.0,
}
_stop_event = threading.Event()
_rec_thread = None


# Windows shared-mode WASAPI mixes at 48 kHz by default; 44.1 kHz is the fallback.
SAMPLE_RATES = [48000, 44100]
CHANNELS = 2
BLOCK = 4096


def list_outputs():
    out = []
    try:
        for i, m in enumerate(sc.all_microphones(include_loopback=True)):
            if getattr(m, "isloopback", False):
                out.append({
                    "index": i,
                    "name": m.name,
                    "channels": CHANNELS,
                    "sample_rate": SAMPLE_RATES[0],
                    "is_default": True,
                })
    except Exception as e:
        return [{"error": str(e)}]
    return out


def _do_record(out_path):
    try:
        mic = sc.get_microphone(id=sc.default_speaker().name, include_loopback=True)
        rec = None
        rate = SAMPLE_RATES[0]
        last_err = None
        for candidate in SAMPLE_RATES:
            try:
                rec = mic.recorder(samplerate=candidate, channels=CHANNELS, blocksize=BLOCK)
                rec.__enter__()
                rate = candidate
                last_err = None
                break
            except Exception as e:
                last_err = e
                continue
        if rec is None:
            raise RuntimeError("no loopback stream could be opened: %s" % last_err)

        _rec["sample_rate"] = rate
        _rec["channels"] = CHANNELS
        try:
            with open(out_path, "wb") as f:
                while not _stop_event.is_set():
                    data = rec.record(numframes=BLOCK)  # float32 (N, 2)
                    pcm = (np.clip(data, -1.0, 1.0) * 32767.0).astype(np.int16)
                    rms = float(np.sqrt(np.mean(data.astype(np.float64) ** 2)))
                    _rec["level"] = rms
                    _emit({"type": "level", "rms": round(rms, 4)})
                    f.write(pcm.tobytes())
                    _rec["bytes"] = os.path.getsize(out_path)
        finally:
            try:
                rec.__exit__(None, None, None)
            except Exception:
                pass

        _rec["duration_s"] = (
            _rec["bytes"] / (_rec["sample_rate"] * _rec["channels"] * 2)
            if _rec["bytes"] and _rec["sample_rate"]
            else 0.0
        )
    except Exception as e:
        _log_err("record failed: %s" % e)
    finally:
        _rec["recording"] = False


def main():
    _emit({"type": "ready"})

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            cmd_obj = json.loads(raw_line)
        except json.JSONDecodeError as e:
            _log_err("bad JSON: %s" % e)
            continue

        cmd = cmd_obj.get("cmd", "")

        if cmd == "quit":
            if _rec["recording"]:
                _stop_event.set()
            _emit({"type": "stopped"})
            break

        elif cmd == "status":
            _emit({
                "type": "status",
                "recording": _rec["recording"],
                "level": _rec["level"],
                "sample_rate": _rec["sample_rate"],
                "bytes": _rec["bytes"],
            })

        elif cmd == "list_outputs":
            _emit({"type": "outputs", "outputs": list_outputs()})

        elif cmd == "start":
            if _rec["recording"]:
                _log_err("already recording")
                continue
            _stop_event.clear()
            fd, out_path = tempfile.mkstemp(prefix="simple-app-audio-", suffix=".pcm")
            os.close(fd)
            _rec.update({
                "recording": True,
                "file": out_path,
                "bytes": 0,
                "duration_s": 0.0,
                "level": 0.0,
            })
            _rec_thread = threading.Thread(target=_do_record, args=(out_path,), daemon=True)
            _rec_thread.start()
            _emit({"type": "ok", "recording": True})

        elif cmd == "stop":
            if not _rec["recording"]:
                _emit({
                    "type": "stopped",
                    "file": _rec.get("file"),
                    "sample_rate": _rec.get("sample_rate"),
                    "channels": _rec.get("channels"),
                    "bytes": _rec.get("bytes", 0),
                    "duration_s": round(_rec.get("duration_s", 0.0), 2),
                })
                continue
            _stop_event.set()
            if _rec_thread and _rec_thread.is_alive():
                _rec_thread.join(timeout=10)
            _emit({
                "type": "stopped",
                "file": _rec.get("file"),
                "sample_rate": _rec.get("sample_rate"),
                "channels": _rec.get("channels"),
                "bytes": _rec.get("bytes", 0),
                "duration_s": round(_rec.get("duration_s", 0.0), 2),
            })

        else:
            _log_err("unknown command: %s" % cmd)


if __name__ == "__main__":
    main()
