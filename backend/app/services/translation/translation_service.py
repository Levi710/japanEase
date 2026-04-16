import os
import asyncio
import requests
from typing import List, Optional
from dotenv import load_dotenv
import riva.client

# Local Translation Imports (Lazy loaded)
local_tokenizer = None
local_model = None

load_dotenv()

LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.glama.ai/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "anthropic/claude-3-5-sonnet")
INVOKE_URL = f"{LLM_BASE_URL}/chat/completions"

# Riva gRPC Configuration
RIVA_GRPC_SERVER = os.getenv("RIVA_GRPC_SERVER")
RIVA_FUNCTION_ID = os.getenv("RIVA_FUNCTION_ID")
RIVA_API_KEY = os.getenv("RIVA_API_KEY")

def load_local_model():
    """Initializes the Helsinki-NLP local model for ja-en translation."""
    global local_tokenizer, local_model
    if local_model is None:
        from transformers import MarianMTModel, MarianTokenizer
        import torch
        model_name = "Helsinki-NLP/opus-mt-ja-en"
        print(f"Loading local translation model: {model_name}...")
        local_tokenizer = MarianTokenizer.from_pretrained(model_name)
        local_model = MarianMTModel.from_pretrained(model_name)
        if torch.cuda.is_available():
            local_model = local_model.to("cuda")
        print("Local translation model loaded.")

async def translate_local(text: str) -> str:
    """Translates Japanese to English using the local MarianMT model."""
    try:
        load_local_model()
        import torch
        
        # Encoding/Decoding/Inference can be intensive; run in background thread
        def _hf_infer():
            inputs = local_tokenizer([text], return_tensors="pt", padding=True)
            if torch.cuda.is_available():
                inputs = {k: v.to("cuda") for k, v in inputs.items()}
            
            with torch.no_grad():
                outputs = local_model.generate(**inputs)
                
            return local_tokenizer.decode(outputs[0], skip_special_tokens=True)

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _hf_infer)
    except Exception as e:
        print(f"Local Translation Error: {e}")
        return None


async def translate_riva_grpc(text: str, target_lang: str = "hi") -> Optional[str]:
    """Translates Japanese to Hindi/English using NVIDIA Riva gRPC."""
    if not RIVA_GRPC_SERVER or not RIVA_FUNCTION_ID:
        return None

    try:
        def _riva_infer():
            auth = riva.client.Auth(
                uri=RIVA_GRPC_SERVER,
                use_ssl=True,
                metadata_args=[
                    ("function-id", RIVA_FUNCTION_ID),
                    ("authorization", f"Bearer {RIVA_API_KEY}")
                ]
            )
            client = riva.client.NeuralMachineTranslationClient(auth)
            
            # Map target language codes (BPC-47)
            # ja-JP to hi-IN
            target_code = "hi-IN" if target_lang == "hindi" else "en-US"
            
            response = client.translate(
                texts=[text],
                model="", # Use default model or specify "riva-translate-1.6b"
                source_language="ja-JP",
                target_language=target_code
            )
            
            if response.translations:
                return response.translations[0].text
            return None

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _riva_infer)
    except Exception as e:
        try:
            print(f"Riva gRPC Translation Error: {e}")
        except:
            print("Riva gRPC Translation Error")
        return None


async def translate_japanese(japanese_text: str, context: List[str] = None, target_lang: str = "hindi", enable_thinking: bool = False) -> str:
    """
    Translates Japanese text to Hindi/English.
    Priority: Local Model (en) -> LLM (if key exists) -> Original Text.
    """
    # 1. Try Local Model First (Only for English)
    if target_lang == "en" or target_lang == "english":
        local_res = await translate_local(japanese_text)
        if local_res: return local_res

    # 2. Try Riva gRPC Primary
    if RIVA_GRPC_SERVER and RIVA_FUNCTION_ID:
        riva_res = await translate_riva_grpc(japanese_text, target_lang=target_lang)
        if riva_res: return riva_res

    # 2. Skip LLM if no key is set
    if not LLM_API_KEY and "localhost" not in LLM_BASE_URL:
        try:
            print(f"No LLM key and local model unavailable for '{japanese_text}'")
        except (UnicodeEncodeError, UnicodeDecodeError):
            print("No LLM key and local model unavailable for [Japanese text]")
        return japanese_text
    
    lang_name = "Hindi (Devanagari script)" if target_lang == "hindi" else "English"
    
    system_prompt = f"Translate the Japanese sentence to {lang_name}. Return ONLY the translation, nothing else."
    if context:
        ctx = " | ".join(context[-3:])
        system_prompt += f" For reference, previous lines were: {ctx}"
    
    headers = {
        "Authorization": f"Bearer {LLM_API_KEY}",
        "Accept": "application/json",
    }
    if not LLM_API_KEY:
        del headers["Authorization"]

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": japanese_text},
        ],
        "max_tokens": 128,
        "temperature": 0.3,
        "top_p": 0.9,
        "stream": False,
        "chat_template_kwargs": {"enable_thinking": False},
    }

    def _call_api():
        try:
            resp = requests.post(INVOKE_URL, headers=headers, json=payload, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            raw = data["choices"][0]["message"]["content"].strip()
            
            # Strip any <think>...</think> reasoning that might leak through
            import re
            raw = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL).strip()
            # Strip any leftover labels
            for prefix in ["Hindi:", "Translation:", "English:", "翻訳:"]:
                if raw.startswith(prefix):
                    raw = raw[len(prefix):].strip()
            return raw
        except Exception as e:
            try:
                error_body = getattr(e.response, 'text', '') if hasattr(e, 'response') else ""
                print(f"LLM API Translation Failed: {e} | Error Body: {error_body}")
            except (UnicodeEncodeError, UnicodeDecodeError):
                print(f"LLM API Translation Failed: {type(e).__name__}")
            return None


    async def _handle_translation():
        loop = asyncio.get_event_loop()
        
        # RETRY LOGIC: Try up to 2 times before falling back
        max_retries = 2
        result = None
        
        for attempt in range(max_retries):
            result = await loop.run_in_executor(None, _call_api)
            if result:
                break
            
            if attempt < max_retries - 1:
                wait_time = 1.5
                try:
                    print(f"LLM failed (Attempt {attempt+1}/{max_retries}). Retrying in {wait_time}s...")
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass
                await asyncio.sleep(wait_time)
        
        if result:
            return result
            
        # Fallback: Local English if target was Hindi and LLM failed
        if target_lang == "hindi":
            try:
                print(f"LLM PERMANENTLY failed after {max_retries} attempts. Falling back to Local English.")
            except (UnicodeEncodeError, UnicodeDecodeError):
                print(f"LLM PERMANENTLY failed. Falling back.")
            local_res = await translate_local(japanese_text)
            if local_res:
                return f"[EN] {local_res}"
        
        return japanese_text

    try:
        return await _handle_translation()
    except Exception as e:
        try:
            print(f"High-Level Translation Error: {e}")
        except (UnicodeEncodeError, UnicodeDecodeError):
            print(f"High-Level Translation Error: {type(e).__name__}")
        return japanese_text
