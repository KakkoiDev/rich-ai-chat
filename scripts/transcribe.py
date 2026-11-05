# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["mlx-whisper==0.4.3", "imageio-ffmpeg==0.6.0"]
# ///
"""Local dictation, using the same multilingual MLX Whisper model as PLH."""
import contextlib
import json
import os
import signal
import subprocess
import sys

signal.alarm(85)

import imageio_ffmpeg
import mlx_whisper
import numpy as np

with open(sys.argv[1], "rb") as source:
    decoded = subprocess.run([
        imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-v", "error",
        "-protocol_whitelist", "pipe", "-f", sys.argv[2], "-i", "pipe:0",
        "-t", "60", "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1",
    ], stdin=source, capture_output=True, check=True, timeout=25)
audio = np.frombuffer(decoded.stdout, dtype="<i2").astype(np.float32) / 32768
text = ""
if audio.size and np.max(np.abs(audio)) > 0.001:
    with contextlib.redirect_stdout(sys.stderr):
        result = mlx_whisper.transcribe(
            audio,
            path_or_hf_repo=os.getenv("PI_WHISPER_MODEL", "mlx-community/whisper-base-mlx"),
            verbose=None,
        )
    text = result["text"].strip()
print(json.dumps({"text": text}, ensure_ascii=False))
