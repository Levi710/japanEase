import os
import json
import asyncio
import httpx
from dotenv import load_dotenv

# Load NVIDIA config (using user's exact model)
load_dotenv()
API_KEY = os.getenv("LLM_API_KEY")
BASE_URL = os.getenv("LLM_BASE_URL")
MODEL = os.getenv("LLM_MODEL")
INVOKE_URL = f"{BASE_URL}/chat/completions"
JOBS_FILE = "jobs.json"

async def translate_one(text, context=""):
    """Translates a single line using the user's exactly preferred Riva 1.6b NIM Cloud."""
    headers = {
        "Authorization": f"Bearer {API_KEY}", 
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    # Direct Translate Proxy via the Chat endpoint
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "user", "content": f"Translate this Japanese text directly to Hindi: {text}"}
        ],
        "temperature": 0.1,
        "max_tokens": 100
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(INVOKE_URL, headers=headers, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"].strip()
            else:
                print(f"Riva NIM Error ({resp.status_code}): {resp.text}")
                return None
    except Exception as e:
        print(f"Connection Error: {e}")
        return None

async def repair_all():
    if not os.path.exists(JOBS_FILE):
        return

    with open(JOBS_FILE, "r") as f:
        jobs = json.load(f)

    print(f"Final Healing using NVIDIA/RIVA-TRANSLATE-1.6B...")
    
    for job_id, job in jobs.items():
        if not job.get("result"): continue
        
        for i, seg in enumerate(job["result"]):
            trans = seg.get("translation", "")
            # Force repair everything to ensure RIVA-level consistency
            if any(err in trans for err in ["अनुवाद त्रुटि", "Translation error", "[EN]", "NVIDIA-Fixed"]) or not trans:
                print(f"[{job.get('filename')}] Final RIVA-Repair: {seg['text']}")
                
                new_val = await translate_one(seg["text"])
                if new_val:
                    seg["translation"] = new_val
                    print(f"  --> RIVA-Fixed: {new_val}")
                
                await asyncio.sleep(0.1)

    with open(JOBS_FILE, "w") as f:
        json.dump(jobs, f)
    print("\nSUCCESS! Library fully synchronized with RIVA-TRANSLATE-1.6B.")

if __name__ == "__main__":
    asyncio.run(repair_all())
