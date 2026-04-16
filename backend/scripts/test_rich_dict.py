import requests
import sys

base_url = "http://localhost:8000"
word = "女性"
if len(sys.argv) > 1:
    word = sys.argv[1]

print(f"Testing /dictionary/rich/{word}...")
try:
    res = requests.get(f"{base_url}/dictionary/rich/{word}", timeout=40)
    print(f"Status Code: {res.status_code}")
    if res.status_code == 200:
        print("Response Content:")
        print(res.text)
    else:
        print(f"Error: {res.text}")
except Exception as e:
    print(f"Request Failed: {e}")
