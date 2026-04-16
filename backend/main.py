import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, UploadFile, File, HTTPException, Form

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from typing import List, Optional, Dict, Any
import shutil
import os
import uuid
import asyncio
import json
import re

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from typing import List, Optional, Dict, Any
import shutil
import os
import uuid
import asyncio
import json
import re
import urllib.parse
from pydantic import BaseModel
from app.services.transcription.whisper_service import transcribe_video_stream
from app.services.furigana.furigana_service import add_furigana
from app.services.translation.translation_service import translate_japanese
from app.services.alignment.alignment_service import align_subtitles
from app.services.dictionary_service import get_jisho_meaning, get_rich_llm_meaning
from app.services.notion_service import save_to_notion, get_saved_words_from_notion

app = FastAPI(title="JapanEase API", description="AI-powered Japanese learning subtitle generator")

# Notion Request Model
class NotionSaveRequest(BaseModel):
    data: dict
    source: Optional[str] = "JapanEase AI"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
JOBS_FILE = "jobs.json"
os.makedirs(UPLOAD_DIR, exist_ok=True)

app.mount("/videos", StaticFiles(directory=UPLOAD_DIR), name="videos")

if os.path.exists(JOBS_FILE):
    with open(JOBS_FILE, "r") as f: jobs = json.load(f)
else: jobs = {}

def save_jobs():
    with open(JOBS_FILE, "w") as f: json.dump(jobs, f)

@app.get("/")
async def root(): return {"message": "Welcome to JapanEase API"}

@app.post("/upload")
async def upload_video(file: UploadFile = File(...), target_lang: str = Form("hindi")):
    job_id = str(uuid.uuid4())
    # Sanitize filename (clean spaces, special chars)
    safe_filename = re.sub(r'[^a-zA-Z0-9_\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff\-.]', '_', file.filename)
    file_path = os.path.join(UPLOAD_DIR, f"{job_id}_{safe_filename}")
    
    with open(file_path, "wb") as b: shutil.copyfileobj(file.file, b)
    
    # Store encoded URL fragment for raw bytes safety
    encoded_filename = urllib.parse.quote(f"{job_id}_{safe_filename}")
    jobs[job_id] = {
        "job_id": job_id, 
        "status": "queued", 
        "progress": 0, 
        "result": [], 
        "target_lang": target_lang, 
        "filename": file.filename, 
        "video_path": file_path,
        "video_url": f"/videos/{encoded_filename}"
    }
    save_jobs()
    asyncio.create_task(process_video(job_id, file_path, target_lang))
    return {"job_id": job_id, "status": "queued", "progress": 0}

@app.get("/library")
async def get_library():
    lib = []
    to_purge = []
    
    for job_id, j in jobs.items():
        if j.get("status") in ["completed", "done"]:
            # Check if file actually exists on DISK
            video_url = j.get("video_url", "")
            filename = urllib.parse.unquote(video_url.replace("/videos/", ""))
            file_path = os.path.join(UPLOAD_DIR, filename)
            
            if not os.path.exists(file_path):
                print(f"Purging ghost entry found during library fetch: {j.get('filename')}")
                to_purge.append(job_id)
                continue

            item = j.copy()
            # Split and encode only the file part
            parts = item["video_url"].split("/videos/")
            if len(parts) > 1 and not "%" in parts[1]:
                item["video_url"] = f"/videos/{urllib.parse.quote(parts[1])}"
            lib.append(item)
            
    # Cleanup ghosts from database
    if to_purge:
        for job_id in to_purge: 
            del jobs[job_id]
        save_jobs()
            
    return lib

@app.get("/status/{job_id}")
async def get_status(job_id: str):
    if job_id not in jobs: raise HTTPException(status_code=404, detail="Job not found")
    j = jobs[job_id].copy()
    if not "%" in j["video_url"]:
        parts = j["video_url"].split("/videos/")
        if len(parts) > 1:
            j["video_url"] = f"/videos/{urllib.parse.quote(parts[1])}"
    return {"job_id": j["job_id"], "status": j["status"], "progress": j["progress"], "result": j["result"], "video_url": j["video_url"]}

class LibrarySegmentsUpdate(BaseModel):
    segments: List[Dict[str, Any]]

@app.put("/library/{job_id}/segments")
async def update_library_segments(job_id: str, request: LibrarySegmentsUpdate):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    jobs[job_id]["result"] = request.segments
    save_jobs()
    return {"status": "success"}

@app.delete("/library/{job_id}")
async def delete_job(job_id: str):
    if job_id not in jobs: raise HTTPException(status_code=404, detail="Job not found")
    
    # Attempt to delete the video file from disk
    video_url = jobs[job_id].get("video_url", "")
    filename = urllib.parse.unquote(video_url.replace("/videos/", ""))
    file_path = os.path.join(UPLOAD_DIR, filename)
    
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except Exception as e:
        print(f"Error deleting file: {e}")

    # Remove from tracking
    del jobs[job_id]
    save_jobs()
    return {"message": "Job deleted successfully"}

@app.get("/dictionary/rich/{word}")
async def fetch_rich_dictionary(word: str, reading: Optional[str] = None):
    """Deep, LLM-powered vocabulary generation for study cards (Save to Mem)."""
    result = await get_rich_llm_meaning(word, reading)
    if not result:
        raise HTTPException(status_code=404, detail="Could not generate rich definition.")
    return result

@app.get("/dictionary/{word}")
async def fetch_dictionary(word: str, reading: Optional[str] = None):
    """Fast, latency-optimized Jisho lookup for the player UI."""
    result = await get_jisho_meaning(word)
    if not result:
        raise HTTPException(status_code=404, detail="Word not found in Jisho.")
    # Override jisho reading with the one from subtitle IF jisho failed to find one
    if reading and not result.get("reading"):
        result["reading"] = reading
    
    # Add context reading if it differs from the dictionary reading
    if reading and reading != result.get("reading"):
        result["context_reading"] = reading
        
    return result

@app.post("/notion/save")
async def save_to_notion_endpoint(request: NotionSaveRequest):
    """Save enriched vocabulary data directly to Notion database."""
    try:
        result = await save_to_notion(request.data, request.source)
        return {"status": "success", "data": result}
    except Exception as e:
        print(f"Notion Save Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/notion/sync")
async def sync_from_notion_endpoint():
    """Fetch all Japanese words currently saved in Notion."""
    try:
        words = await get_saved_words_from_notion()
        return {"status": "success", "words": words}
    except Exception as e:
        print(f"Notion Sync Endpoint Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def process_video(job_id: str, file_path: str, target_lang: str = "hindi"):
    try:
        jobs[job_id]["status"] = "transcribing"
        jobs[job_id]["result"] = []
        jobs[job_id]["progress"] = 5
        save_jobs()
        
        # Stream chunks of 5 lines at a time
        chunk_index = 0
        context_history = []  # Keep last 3 lines
        saw_segments = False
        
        async for segments_chunk, duration in transcribe_video_stream(file_path, chunk_size=5):
            if not segments_chunk:
                continue

            if not saw_segments:
                jobs[job_id]["status"] = "processing_chunks"
                saw_segments = True
            
            # Step 2: Furigana for this chunk
            processed_segments = []
            for i, seg in enumerate(segments_chunk):
                furigana_data = add_furigana(seg["text"])
                processed_segments.append({
                    "id": f"chunk_{chunk_index}_{i}",
                    "start": seg["start"],
                    "end": seg["end"],
                    "text": seg["text"],
                    "furigana": furigana_data,
                })

            # Step 3: Refined Translation for this chunk (with context)
            for seg in processed_segments:
                seg["translation"] = await translate_japanese(seg["text"], context=context_history, target_lang=target_lang)
                
                # Update context history (only keep 3 most recent lines)
                context_history.append(seg["text"])
                if len(context_history) > 3:
                    context_history.pop(0)

            # Step 4: Final Alignment for this chunk
            final_chunk = align_subtitles(processed_segments)
            
            # Append immediately so the UI can stream it live!
            jobs[job_id]["result"].extend(final_chunk)
            
            if segments_chunk:
                last_end = segments_chunk[-1]["end"]
                jobs[job_id]["progress"] = min(99, int((last_end / max(duration, 1)) * 100))
                if chunk_index % 5 == 0:
                    save_jobs()
                
            chunk_index += 1

        if not saw_segments:
            raise RuntimeError("No speech could be transcribed from the uploaded video.")

        jobs[job_id]["status"] = "completed"
        jobs[job_id]["progress"] = 100
        save_jobs()

    except Exception as e:
        import traceback
        traceback.print_exc()
        jobs[job_id]["status"] = f"failed: {str(e)}"
        jobs[job_id]["progress"] = 0
        save_jobs()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
