import fugashi
import re

# Initialize Tagger
tagger = fugashi.Tagger()

def to_hiragana(text: str):
    """Safely converts Katakana to Hiragana while preserving symbols like long vowels."""
    if not text: return None
    res = []
    for c in text:
        # Range of standard Katakana to Hiragana (excluding characters like 'ー')
        if 0x30A1 <= ord(c) <= 0x30F6:
            res.append(chr(ord(c) - 0x60))
        else:
            res.append(c)
    return "".join(res)

def get_segments(surface: str, reading: str):
    """
    Splits surface into segments with their corresponding furigana to allow
    precise ruby positioning in the UI.
    Example: '食べた' -> [{'text': '食', 'f': 'た'}, {'text': 'べた', 'f': None}]
    """
    if not reading or surface == reading:
        return [{"text": surface, "f": None}]
    
    # Trim matching suffix (e.g., 'た' in '来た')
    suffix_text = ""
    temp_s = surface
    temp_r = reading
    while len(temp_s) > 1 and len(temp_r) > 1 and temp_s[-1] == temp_r[-1]:
        suffix_text = temp_s[-1] + suffix_text
        temp_s = temp_s[:-1]
        temp_r = temp_r[:-1]
    
    # Trim matching prefix (less common, e.g., 'お' in 'お茶')
    prefix_text = ""
    while len(temp_s) > 1 and len(temp_r) > 1 and temp_s[0] == temp_r[0]:
        prefix_text += temp_s[0]
        temp_s = temp_s[1:]
        temp_r = temp_r[1:]
    
    segments = []
    if prefix_text:
        segments.append({"text": prefix_text, "f": None})
    if temp_s:
        # Isolated kanji part gets the corresponding reading slice
        segments.append({"text": temp_s, "f": temp_r})
    if suffix_text:
        segments.append({"text": suffix_text, "f": None})
        
    return segments

def add_furigana(text: str):
    """
    Takes Japanese text and returns a list of dictionaries with surface and furigana.
    Handles 'Okurigana' by isolating Kanji readings.
    """
    results = []
    for word in tagger(text):
        surface = word.surface
        
        # Determine the best reading field
        feature = word.feature
        reading_raw = getattr(feature, 'kana', None) or getattr(feature, 'reading', None)
        if hasattr(feature, 'form') and feature.form:
            reading_raw = feature.form
            
        reading_hira = to_hiragana(reading_raw)
        
        # Check if word contains Kanji
        if re.search(r'[\u4e00-\u9faf]', surface):
            segments = get_segments(surface, reading_hira)
            # Find the first furigana for backward compatibility of 'furigana' field
            isolated_furigana = next((s["f"] for s in segments if s["f"]), reading_hira) if reading_hira != surface else None
            results.append({
                "surface": surface, 
                "furigana": isolated_furigana, 
                "segments": segments
            })
        else:
            results.append({"surface": surface, "furigana": None, "segments": [{"text": surface, "f": None}]})
            
    return results
