import os
import json
import asyncio
import httpx
from dotenv import load_dotenv

# Load NVIDIA config
load_dotenv()
API_KEY = os.getenv("LLM_API_KEY")
BASE_URL = os.getenv("LLM_BASE_URL")
MODEL = os.getenv("LLM_MODEL")
INVOKE_URL = f"{BASE_URL}/chat/completions"
JOBS_FILE = "jobs.json"

async def translate_one(text, context=""):
    """Translates a single line to Hindi using NVIDIA Cloud."""
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "You are a master Japanese-to-Hindi translator. Return ONLY the direct translation. No labels."},
            {"role": "user", "content": f"Context: {context}\n\nTranslate: {text}"}
        ],
        "temperature": 0.1,
        "max_tokens": 512
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(INVOKE_URL, headers=headers, json=payload)
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"Error translating '{text}': {e}")
        return None

async def repair_library():
    if not os.path.exists(JOBS_FILE):
        print("No jobs found.")
        return

    with open(JOBS_FILE, "r") as f:
        jobs = json.load(f)

    print(f"Repairing {len(jobs)} jobs...")
    
    for job_id, job in jobs.items():
        if not job.get("result"): continue
        if job.get("target_lang") != "hindi": continue
        
        broken_count = 0
        for i, seg in enumerate(job["result"]):
            # Check if segment has an error string or is missing translation
            if any(err in seg.get("translation", "") for err in ["अनुवाद त्रुटि", "Translation error", "[EN]"]):
                broken_count += 1
                context = job["result"][i-1]["text"] if i > 0 else ""
                print(f"[{job_id}] Repairing: {seg['text']}...")
                
                new_trans = await translate_one(seg["text"], context)
                if new_trans:
                    seg["translation"] = new_trans
                    print(f"  Fixed: {new_trans}")
                
                # Sleep slightly to avoid rate limits on free NVIDIA credits if applicable
                await asyncio.sleep(0.5)

        if broken_count > 0:
            print(f"Job {job_id}: Repaired {broken_count} lines.")

    # Save fixed jobs
    with open(JOBS_FILE, "w") as f:
        json.dump(jobs, f)
    print("Repair complete! Refresh your browser.")

if __name__ == "__main__":
    asyncio.run(repair_library())
