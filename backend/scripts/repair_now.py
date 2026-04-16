import os
import json
import asyncio
import httpx
from dotenv import load_dotenv

# Load NVIDIA config from .env
load_dotenv()
API_KEY = "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"
BASE_URL = "https://integrate.api.nvidia.com/v1"
MODEL = "meta/llama-3.1-70b-instruct"
INVOKE_URL = f"{BASE_URL}/chat/completions"
JOBS_FILE = "jobs.json"

async def translate_one(text, context=""):
    """Translates a single line to Hindi using NVIDIA's Llama 3.1 Cloud."""
    headers = {
        "Authorization": f"Bearer {API_KEY}", 
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "You are a master Japanese-to-Hindi translator. Context is provided if available. Return ONLY the Hindi translation. No additional text."},
            {"role": "user", "content": f"Japanese Text: {text}\nContext: {context}"}
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
                print(f"API Error ({resp.status_code}): {resp.text}")
                return None
    except Exception as e:
        print(f"Connection Error for '{text}': {e}")
        return None

async def repair_all():
    if not os.path.exists(JOBS_FILE):
        print("No jobs.json found.")
        return

    with open(JOBS_FILE, "r") as f:
        jobs = json.load(f)

    print(f"Healing {len(jobs)} videos in the library...")
    fixed_count = 0
    for job_id, job in jobs.items():
        if not job.get("result"): continue
        
        # Check every segment for errors
        for i, seg in enumerate(job["result"]):
            trans = seg.get("translation", "")
            if "अनुवाद त्रुटि" in trans or "Translation error" in trans or "[EN]" in trans or not trans:
                print(f"[{job.get('filename')}] Repairing line: {seg['text']}")
                context = job["result"][max(0, i-1)]["text"] if i > 0 else ""
                
                new_hira = await translate_one(seg["text"], context)
                if new_hira:
                    seg["translation"] = new_hira
                    print(f"  --> Fixed: {new_hira}")
                    fixed_count += 1
                
                # Tiny sleep to be kind to the API
                await asyncio.sleep(0.2)

    if fixed_count > 0:
        with open(JOBS_FILE, "w") as f:
            json.dump(jobs, f)
        print(f"\nSUCCESS! Fixed {fixed_count} subtitles. Refresh your library!")
    else:
        print("No broken subtitles found to fix.")

if __name__ == "__main__":
    asyncio.run(repair_all())
