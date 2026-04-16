import os
import httpx
from typing import Dict, Any
from dotenv import load_dotenv
from app.services.furigana.furigana_service import add_furigana

load_dotenv()

NOTION_VERSION = "2022-06-28"
NOTION_API_URL = "https://api.notion.com/v1/pages"

def format_furigana_for_notion(text: str) -> str:
    """Formats Japanese text with readings in 'Kanji(Reading)' style for Notion."""
    if not text:
        return ""
    
    try:
        tokens = add_furigana(text)
        formatted_parts = []
        
        for token in tokens:
            segments = token.get("segments", [])
            for seg in segments:
                if seg.get("f"):
                    formatted_parts.append(f"{seg['text']}({seg['f']})")
                else:
                    formatted_parts.append(seg['text'])
        
        return "".join(formatted_parts)
    except Exception as e:
        print(f"Error formatting furigana for Notion: {e}")
        return text

async def save_to_notion(data: Dict[str, Any], source_anime: str = "JapanEase AI"):
    load_dotenv()  # Ensure (.env) is explicitly loaded inside the function
    token = os.getenv("NOTION_TOKEN")
    page_id = os.getenv("NOTION_PAGE_ID")
    
    try:
        print(f"Debug Notion: Token found? {'Yes' if token else 'No'}, PageID found? {'Yes' if page_id else 'No'}")
    except:
        print("Debug Notion: Environment variables check...")
    
    if not token or not page_id:
        raise Exception("NOTION_TOKEN or NOTION_PAGE_ID not found in environment")

    # Construct Notion payload
    body = {
        "parent": { "page_id": page_id },
        "properties": {
            "title": [
                {
                    "type": "text",
                    "text": {
                        "content": f"{data['word']} ({data['reading']})"
                    }
                }
            ]
        },
        "children": [
            {
                "object": "block",
                "type": "heading_2",
                "heading_2": {
                    "rich_text": [{"type": "text", "text": {"content": f"Vocab: {data['word']}"}}]
                }
            },
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [
                        {"type": "text", "text": {"content": "Reading: "}, "annotations": {"bold": True}},
                        {"type": "text", "text": {"content": data['reading']}}
                    ]
                }
            },
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [
                        {"type": "text", "text": {"content": "Source: "}, "annotations": {"bold": True}},
                        {"type": "text", "text": {"content": source_anime}}
                    ]
                }
            },
            {
                "object": "block",
                "type": "heading_3",
                "heading_3": {
                    "rich_text": [{"type": "text", "text": {"content": "Meaning (English)"}}]
                }
            },
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{"type": "text", "text": {"content": data['meaning_en']}}]
                }
            },
            {
                "object": "block",
                "type": "heading_3",
                "heading_3": {
                    "rich_text": [{"type": "text", "text": {"content": "Meaning (Hindi)"}}]
                }
            },
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{"type": "text", "text": {"content": data['meaning_hi']}}]
                }
            },
            {
                "object": "block",
                "type": "heading_3",
                "heading_3": {
                    "rich_text": [{"type": "text", "text": {"content": "Example Sentences"}}]
                }
            }
        ]
    }

    # Add example sentences as bullet items
    for ex in data.get('examples', []):
        jp_with_furigana = format_furigana_for_notion(ex['jp'])
        body["children"].append({
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [
                    {"type": "text", "text": {"content": jp_with_furigana}, "annotations": {"bold": True}},
                    {"type": "text", "text": {"content": " → "}},
                    {"type": "text", "text": {"content": ex['hi']}, "annotations": {"italic": True}}
                ]
            }
        })

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(NOTION_API_URL, headers=headers, json=body)
        if response.status_code >= 400:
            error_detail = response.text
            try:
                print(f"Notion API Error {response.status_code}: {error_detail}")
            except:
                print(f"Notion API Error {response.status_code}")
            raise Exception(f"Notion API Error {response.status_code}: {error_detail}")
        return response.json()


async def get_saved_words_from_notion() -> list:
    """Fetches the list of Japanese words currently saved in Notion."""
    load_dotenv()
    token = os.getenv("NOTION_TOKEN")
    page_id = os.getenv("NOTION_PAGE_ID")

    if not token or not page_id:
        return []

    url = f"https://api.notion.com/v1/blocks/{page_id}/children?page_size=100"
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)
            if response.status_code != 200:
                print(f"Notion Sync failed with status {response.status_code}")
                return []
            
            data = response.json()
            results = data.get("results", [])
            saved_words = []
            
            import re
            for block in results:
                if block.get("type") == "child_page":
                    title = block["child_page"]["title"]
                    # More robust parsing: 
                    # 1. Handle common Japanese delimiters: ( ), （ ）, 【 】, [ ], ［ ］
                    # 2. Extract anything before the first delimiter
                    word = title
                    # Look for the start of any parenthesis-like character
                    match = re.search(r"[\(\（【\[［]", title)
                    if match:
                        word = title[:match.start()].strip()
                    else:
                        word = title.strip()
                    
                    if word:
                        page_id_raw = block["id"].replace("-", "")
                        saved_words.append({
                            "word": word,
                            "url": f"https://notion.so/{page_id_raw}"
                        })
            
            return saved_words
    except Exception as e:
        print(f"Notion Sync Error: {e}")
        return []
