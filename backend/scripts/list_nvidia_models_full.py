import requests
import json

URL = "https://integrate.api.nvidia.com/v1/models"
HEADERS = {
    "Authorization": "Bearer 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",
    "Accept": "application/json"
}

try:
    resp = requests.get(URL, headers=HEADERS)
    resp.raise_for_status()
    data = resp.json()
    # Print the all model IDs to find Riva
    for m in data.get("data", []):
        print(f"- {m['id']}")
except Exception as e:
    print(f"Error listing models: {e}")
