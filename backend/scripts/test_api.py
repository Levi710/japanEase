import requests
import time
import json
import os

base_url = "http://localhost:8000"
results = {}

video_path = r"c:\Users\ayush\OneDrive\Desktop\japanEase\video\test_short.mp4"

print("Starting Upload and Processing Test with Real Video...")
if not os.path.exists(video_path):
    print("Video file not found!")
    exit(1)

with open(video_path, "rb") as f:
    print(f"Uploading {os.path.basename(video_path)}...")
    res = requests.post(f"{base_url}/upload", files={"file": (os.path.basename(video_path), f)})

results["upload_status_code"] = res.status_code
if res.status_code == 200:
    data = res.json()
    job_id = data.get("job_id")
    results["job_id"] = job_id
    print(f"Uploaded! Job ID: {job_id}")
    
    poll_results = []
    # Poll status until completed or failed
    last_progress = -1
    last_status = ""
    while True:
        try:
            res_status = requests.get(f"{base_url}/status/{job_id}")
            if res_status.status_code == 200:
                s_data = res_status.json()
                status = s_data.get("status")
                progress = s_data.get("progress")
                
                if progress != last_progress or status != last_status:
                    print(f"Status: {status} | Progress: {progress}%")
                    last_progress = progress
                    last_status = status
                    poll_results.append({
                        "status": status,
                        "progress": progress
                    })
                
                if status == "completed":
                    print("Processing completed successfully!")
                    results["final_result"] = s_data.get("result")
                    break
                elif str(status).startswith("failed"):
                    print(f"Processing failed: {status}")
                    break
            else:
                print(f"Error polling status: {res_status.status_code}")
                break
        except Exception as e:
            print(f"Exception during polling: {e}")
            break
            
        time.sleep(2)
        
    results["poll_results"] = poll_results
else:
    print(f"Upload failed: {res.text}")
    results["upload_error"] = res.text

with open("test_api_result.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print("\nTest finished. Results saved to test_api_result.json")
