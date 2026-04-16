import os
import httpx
import json
import urllib.parse
from typing import Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.glama.ai/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "anthropic/claude-3-5-sonnet")
INVOKE_URL = f"{LLM_BASE_URL}/chat/completions"

# Local Dictionary (Lazy loaded)
jam_dict = None

def get_jamdict():
    global jam_dict
    if jam_dict is None:
        from jamdict import Jamdict
        print("Loading local Jamdict database...")
        jam_dict = Jamdict()
    return jam_dict

async def get_jisho_meaning(word: str) -> Dict[str, Any]:
    """Fetches word data. Priority: Jisho API -> Local Jamdict."""
    
    # 1. Online Jisho.org (Now the Priority)
    safe_word = urllib.parse.quote(word)
    url = f"https://jisho.org/api/v1/search/words?keyword={safe_word}"
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            if response.status_code == 200:
                data = response.json()
                if data and data.get('data'):
                    # Find the BEST matching entry (exact word match)
                    # This prevents 'Ko' or 'Rai' confusion for standalone 'Kuru'
                    best_entry = None
                    for entry in data['data']:
                        for ja in entry.get('japanese', []):
                            if ja.get('word') == word or ja.get('reading') == word:
                                best_entry = entry
                                break
                        if best_entry: break
                    
                    # Fallback to first entry if no exact match found
                    first_entry = best_entry if best_entry else data['data'][0]
                    
                    # Find the best reading within the entry
                    best_ja = first_entry.get('japanese', [{}])
                    reading = best_ja[0].get('reading', '')
                    for ja in best_ja:
                        if ja.get('word') == word:
                            reading = ja.get('reading', reading)
                            break

                    definitions = first_entry.get('senses', [{}])[0].get('english_definitions', [])
                    parts_of_speech = first_entry.get('senses', [{}])[0].get('parts_of_speech', [])
                    is_common = first_entry.get('is_common', False)
                    jlpt = [tag for tag in first_entry.get('tags', []) if "jlpt" in tag.lower()]

                    return {
                        "word": word,
                        "reading": reading,
                        "meaning": definitions,
                        "parts_of_speech": parts_of_speech,
                        "is_common": is_common,
                        "jlpt": jlpt[0] if jlpt else None,
                        "is_rich": False,
                        "source": "Jisho.org (Live)"
                    }
    except Exception as e:
        print(f"Jisho Service Error: {str(e)}")

    # 2. Local Fallback (Jamdict)
    try:
        jmd = get_jamdict()
        result = jmd.lookup(word)
        if result.entries:
            entry = result.entries[0]
            reading = entry.kana_forms[0].text if entry.kana_forms else ""
            definitions = []
            parts_of_speech = []
            for sense in entry.senses:
                definitions.extend(sense.gloss)
                parts_of_speech.extend([str(pos) for pos in sense.pos])
            
            return {
                "word": word,
                "reading": reading,
                "meaning": definitions[:5],
                "parts_of_speech": list(set(parts_of_speech)),
                "is_common": any(kf.pri for kf in entry.kana_forms) or any(kf.pri for kf in entry.kanji_forms),
                "jlpt": None,
                "is_rich": False,
                "source": "Local Jamdict (Fallback)"
            }
    except Exception as e:
        print(f"Jamdict Local Error: {str(e)}")

    return None

async def _jisho_as_rich(word: str) -> Optional[Dict[str, Any]]:
    """Fallback: wraps Jisho data into the rich format so Notion saves still work."""
    jisho = await get_jisho_meaning(word)
    if not jisho:
        return None
    return {
        "word": jisho["word"],
        "reading": jisho.get("reading", word),
        "romaji": "",
        "jlpt": jisho.get("jlpt") or "unknown",
        "part_of_speech": ", ".join(jisho.get("parts_of_speech", [])) or "unknown",
        "meaning_en": "; ".join(jisho.get("meaning", ["unknown"])),
        "meaning_hi": "",
        "examples": [],
        "is_rich": True,
    }

async def get_rich_llm_meaning(word: str, reading: Optional[str] = None) -> Dict[str, Any]:
    """Generates deep, LLM-powered vocabulary metadata. Falls back to Jisho if LLM is unavailable."""
    if not LLM_API_KEY and "localhost" not in LLM_BASE_URL:
        try:
            print(f"No LLM key set. Falling back to Jisho for '{word}'.")
        except:
            print(f"No LLM key set. Falling back to Jisho for [Japanese word].")
        return await _jisho_as_rich(word)

    system_prompt = (
        "You are a professional Japanese-to-Hindi/English dictionary assistant. "
        "Your goal is to provide deep, accurate, and culturally appropriate Hindi/English definitions and examples. "
        "Return ONLY a valid JSON object. No markdown, no backticks.\n\n"
        "Shape:\n"
        "{\n"
        "  \"word\": \"<word>\",\n"
        "  \"reading\": \"<reading>\",\n"
        "  \"romaji\": \"<romaji>\",\n"
        "  \"base_form\": \"<dictionary_form>\",\n"
        "  \"base_reading\": \"<dictionary_reading>\",\n"
        "  \"jlpt\": \"<N5-N1>\",\n"
        "  \"part_of_speech\": \"<pos>\",\n"
        "  \"meaning_en\": \"<en>\",\n"
        "  \"meaning_hi\": \"<hi>\",\n"
        "  \"examples\": [\n"
        "    { \"jp\": \"<jp_sentence>\", \"hi\": \"<hi_sentence>\" },\n"
        "    { \"jp\": \"<jp_sentence_2>\", \"hi\": \"<hi_sentence_2>\" }\n"
        "  ]\n"
        "}"
    )

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Generate study card for word: {word} (Expected reading: {reading if reading else 'detect automatically'}"}
        ],
        "temperature": 1.0,
        "top_p": 0.95,
        "max_tokens": 16384,
        "chat_template_kwargs": {"enable_thinking": True}
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            headers = {"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"}
            # Cleanly handle empty key if using local Ollama
            if not LLM_API_KEY:
                del headers["Authorization"]
            
            response = await client.post(INVOKE_URL, headers=headers, json=payload)
            response.raise_for_status()
            
            content = response.json()["choices"][0]["message"]["content"].strip()
            if "```" in content:
                content = content.split("```")[1].replace("json", "").strip()
            
            dict_data = json.loads(content)
            
            # Ensure the reading matches the one from subtitle if provided
            if reading:
                dict_data["reading"] = reading
                
            dict_data["is_rich"] = True
            return dict_data
    except httpx.TimeoutException:
        try:
            print(f"LLM Timeout for '{word}'. Falling back to Jisho data.")
        except:
            print(f"LLM Timeout. Falling back to Jisho data.")
        return await _jisho_as_rich(word)
    except Exception as e:
        import traceback
        try:
            print(f"LLM Error during generation for '{word}': {str(e)}. Falling back to Jisho.")
        except:
            print(f"LLM Error during generation. Falling back to Jisho.")
        traceback.print_exc()
        return await _jisho_as_rich(word)
