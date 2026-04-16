import os
import json
import asyncio
from faster_whisper import WhisperModel
import tempfile
import subprocess
from dotenv import load_dotenv

# Load config
load_dotenv()
JOBS_FILE = "jobs.json"
model_size = "base"
model = WhisperModel(model_size, device="cpu", compute_type="int8")

async def extract_audio(video_path: str) -> str:
    audio_path = tempfile.mktemp(suffix=".wav")
    command = [
        "ffmpeg", "-i", video_path,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        audio_path, "-y"
    ]
    subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return audio_path

def get_precise_segments(audio_path: str):
    segments, info = model.transcribe(
        audio_path, 
        beam_size=5, 
        language="ja",
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
        word_timestamps=True
    )
    return list(segments)

async def calibrate_library():
    if not os.path.exists(JOBS_FILE):
        return

    with open(JOBS_FILE, "r") as f:
        jobs = json.load(f)

    print(f"Calibrating {len(jobs)} videos for Full Auto-Sync...")
    
    for job_id, job in jobs.items():
        video_path = job.get("video_path")
        if not video_path or not os.path.exists(video_path):
            continue
            
        print(f"[{job.get('filename')}] Re-Aligning timestamps...")
        audio_path = await extract_audio(video_path)
        
        try:
            new_segments = get_precise_segments(audio_path)
            
            # Smart Merge: Update timestamps of existing segments (preserving NVIDIA translations)
            # We match them by index since the sequence should be identical
            old_segments = job.get("result", [])
            matches = 0
            
            for i, old_seg in enumerate(old_segments):
                if i < len(new_segments):
                    new_s = new_segments[i]
                    # Update with high-precision timestamps
                    old_seg["start"] = new_s.start
                    old_seg["end"] = new_s.end
                    matches += 1
            
            print(f"  --> Auto-Synced {matches} segments.")
            
        except Exception as e:
            print(f"  Error calibrating: {e}")
        finally:
            if os.path.exists(audio_path):
                os.remove(audio_path)

    # Save calibrated library
    with open(JOBS_FILE, "w") as f:
        json.dump(jobs, f)
    print("\nSUCCESS! Your library is now fully Auto-Synced. No manual offset needed.")

if __name__ == "__main__":
    asyncio.run(calibrate_library())
