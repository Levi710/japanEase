import fugashi
import re

tagger = fugashi.Tagger()

def debug_furigana(text):
    print(f"Original: {text}")
    for word in tagger(text):
        surface = word.surface
        feature = word.feature
        
        print(f"Token: {surface}")
        # Print all fields if available
        if hasattr(feature, '_asdict'):
            d = feature._asdict()
            for k, v in d.items():
                print(f"  {k}: {v}")
        else:
            print(f"  Raw: {feature}")

print("--- Test 1: Kita ---")
debug_furigana("来た")
print("\n--- Test 2: Gakuen ---")
debug_furigana("学園")
