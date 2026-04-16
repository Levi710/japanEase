import requests
import json

# Ollama OpenAI-compatible endpoint (for Ollama 0.1.24 or newer)
url = "http://localhost:11434/v1/chat/completions"
payload = {
    "model": "gpt-oss:20b",
    "messages": [{"role": "user", "content": "Translate 'Hello' to Hindi. Return only the translated word."}],
    "max_tokens": 10
}
headers = {"Content-Type": "application/json"}

try:
    print(f"Testing Ollama at: {url}")
    response = requests.post(url, json=payload, headers=headers, timeout=60)
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        content = response.json()['choices'][0]['message']['content']
        print(f"Response: {content}")
    else:
        print(f"Error Body: {response.text}")
except Exception as e:
    print(f"Connection Failed: {e}")
