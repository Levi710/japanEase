import os
import json
import urllib.parse
from dotenv import load_dotenv

# Load config
load_dotenv()
JOBS_FILE = "jobs.json"
UPLOAD_DIR = "uploads"

def cleanup_ghosts():
    if not os.path.exists(JOBS_FILE):
        print("No jobs.json found.")
        return

    with open(JOBS_FILE, "r") as f:
        jobs = json.load(f)

    print(f"Checking {len(jobs)} total jobs for ghost entries...")
    ghosts_found = 0
    to_delete = []

    for job_id, job in jobs.items():
        video_url = job.get("video_url", "")
        # Extract filename from URL
        filename = urllib.parse.unquote(video_url.replace("/videos/", ""))
        file_path = os.path.join(UPLOAD_DIR, filename)
        
        if not os.path.exists(file_path):
            print(f"Ghost Found: {job.get('filename')} (ID: {job_id}) - File missing at {file_path}")
            to_delete.append(job_id)
            ghosts_found += 1

    for job_id in to_delete:
        del jobs[job_id]

    if ghosts_found > 0:
        with open(JOBS_FILE, "w") as f:
            json.dump(jobs, f)
        print(f"\nSUCCESS! Purged {ghosts_found} ghost entries from the library.")
    else:
        print("No ghost entries found. Library is healthy.")

if __name__ == "__main__":
    cleanup_ghosts()
