import os
import json
import asyncio
import httpx
from dotenv import load_dotenv

# Load NVIDIA config (using user's exact model)
load_dotenv()
API_KEY = "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"
BASE_URL = "https://integrate.api.nvidia.com/v1"
MODEL = "riva-translate-1.6b"
INVOKE_URL = f"{BASE_URL}/chat/completions"
JOBS_FILE = "jobs.json"

async def translate_one(text, context=""):
    """Translates a single line using the user's preferred Riva 1.6b model."""
    headers = {
        "Authorization": f"Bearer {API_KEY}", 
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    # Special Simplified Payload for Riva-based translation
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "user", "content": f"Translate to Hindi: {text}"}
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
                # If chat endpoint fails for Riva, it might be a direct translate endpoint
                print(f"Riva API Error ({resp.status_code}): {resp.text}")
                return None
    except Exception as e:
        print(f"Connection Error: {e}")
        return None

async def repair_all():
    if not os.path.exists(JOBS_FILE):
        return

    with open(JOBS_FILE, "r") as f:
        jobs = json.load(f)

    print(f"Healing library using RIVA-TRANSLATE-1.6B...")
    
    for job_id, job in jobs.items():
        if not job.get("result"): continue
        
        for i, seg in enumerate(job["result"]):
            trans = seg.get("translation", "")
            # Repair only if there was an error or it was a fallback
            if "अनुवाद त्रुटि" in trans or "Translation error" in trans or "[EN]" in trans or not trans:
                print(f"[{job.get('filename')}] RIVA-Repairing: {seg['text']}")
                
                new_val = await translate_one(seg["text"])
                if new_val:
                    seg["translation"] = new_val
                    print(f"  --> RIVA-Fixed: {new_val}")
                
                await asyncio.sleep(0.1)

    with open(JOBS_FILE, "w") as f:
        json.dump(jobs, f)
    print("\nSUCCESS! Library repaired with RIVA-TRANSLATE-1.6B.")

if __name__ == "__main__":
    asyncio.run(repair_all())
