import fugashi
import re

tagger = fugashi.Tagger()

def get_best_reading(word):
    feature = word.feature
    # UniDic uses 'kana' or 'form' for surface reading
    # IPADIC uses 'reading'
    reading = getattr(feature, 'kana', None) or getattr(feature, 'reading', None)
    
    # UniDic check: 'form' is usually the surface reading (inflected)
    if hasattr(feature, 'form') and feature.form:
        reading = feature.form
        
    return reading

def debug_furigana(text):
    print(f"--- {text} ---")
    for word in tagger(text):
        r = get_best_reading(word)
        print(f"Token: {word.surface} | Reading: {r} | POS: {word.feature.pos1}")

debug_furigana("来た")
debug_furigana("来る")
debug_furigana("来年")
debug_furigana("学生")
