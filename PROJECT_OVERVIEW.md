# JapanEase: AI-Powered Japanese Learning Platform

This document provides a comprehensive overview of the **JapanEase** project, including its tech stack, architecture, and a detailed breakdown of key files and logic.

---

## 🚀 1. Tech Stack

### **Frontend**
- **Framework:** [Next.js 15+](https://nextjs.org/) (App Router)
- **Library:** [React 19](https://react.dev/)
- **Language:** TypeScript
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) (Modern utility-first CSS)
- **Animations:** [Framer Motion](https://www.framer.com/motion/) (Smooth transitions and UI interactions)
- **Icons:** [Lucide React](https://lucide.dev/)
- **API Client:** [Axios](https://axios-http.com/) (For backend communication)

### **Backend**
- **Framework:** [FastAPI](https://fastapi.tiangolo.com/) (High-performance Python web framework)
- **Language:** Python 3.x
- **Transcription (AI):** [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper) (Optimized transcription of video/audio)
- **Linguistic Engine:** 
  - **Fugashi:** A wrapper for MeCab (Japanese tokenizer)
  - **Unidic-Lite:** Core Japanese dictionary data
- **Processing:** [FFMPEG](https://ffmpeg.org/) (Handles video/audio extraction)
- **Data Validation:** [Pydantic](https://docs.pydantic.dev/)
- **Task Management:** Asyncio (In-memory background tasks for simplicity)

---

## 🏗️ 2. Architecture & Data Flow

### **General Architecture**
JapanEase follows a **Client-Server Architecture**. The frontend handles the user interface and video playback, while the backend performs compute-intensive AI tasks (transcription, translation, and linguistic analysis).

### **End-to-End Data Flow**
1.  **Video Upload:** The user selects a video file in the frontend. It is sent via `POST` to `/upload`.
2.  **Job Queuing:** The backend generates a unique `job_id`, saves the video to the `uploads/` directory, and initializes an in-memory job status tracker.
3.  **Background Processing:** A background task (`process_video`) begins immediately:
    - **Transcription:** `Faster-Whisper` extracts Japanese text with precise timestamps (`start` and `end`).
    - **Chunking:** To provide a "live" feel, the backend processes subtitles in small chunks (e.g., 5 lines at a time).
    - **Linguistic Processing:** For each segment, `Fugashi` tokenizes the text and `Unidic-Lite` provides reading data (furigana).
    - **Translation:** The text is translated (currently into Hindi) to provide context for the learner.
    - **Alignment:** Subtitles are formatted into a JSON structure compatible with the video player.
4.  **Frontend Polling:** The frontend periodically sends `GET` requests to `/status/{job_id}` to retrieve newly processed subtitle chunks and track overall progress.
5.  **Interactive Playback:** The `SubtitlePlayer` component renders the video and displays interactive subtitles. Users can hover over words to see furigana or click them to fetch dictionary definitions.

---

## 📂 3. File-by-File Breakdown

### **Backend (`/backend`)**
| File/Directory | Role | Key Functionality |
| :--- | :--- | :--- |
| `main.py` | **App Entry Point** | Defines routes (`/upload`, `/status`, `/dictionary`), manages CORS, and orchestrates the `process_video` pipeline. |
| `app/services/transcription/whisper_service.py` | **AI Transcriber** | Uses `faster-whisper` to convert video audio into timestamped text segments. |
| `app/services/furigana/furigana_service.py` | **Reading Aid** | Uses `fugashi` to add furigana (hiragana/katakana readings) above kanji characters. |
| `app/services/translation/translation_service.py` | **Context Provider** | Handles the translation of Japanese segments (e.g., into Hindi). |
| `app/services/dictionary_service.py` | **Word Lookup** | Fetches detailed definitions for Japanese words when a user clicks/interacts with them. |
| `app/services/alignment/alignment_service.py` | **Synchronizer** | Ensures the generated subtitles perfectly match the video timeline. |
| `uploads/` | **Storage** | Temporary directory where uploaded video files are stored during processing. |

### **Frontend (`/frontend`)**
| File/Directory | Role | Key Functionality |
| :--- | :--- | :--- |
| `src/app/page.tsx` | **Main Dashboard** | Manages the primary application state (file upload, progress tracking, overall UI layout). |
| `src/app/layout.tsx` | **Global Layout** | Configures global fonts (Inter, Roboto), SEO tags, and base styling. |
| `src/components/SubtitlePlayer.tsx` | **Core Player** | A complex component that syncs the video element with the processed subtitle JSON. Handles interactive word-hover effects. |
| `src/app/globals.css` | **Styles** | Global CSS and Tailwind directives. |

---

## 🔍 4. Key Logic (Line-Level)

### **Backend: `backend/main.py`**
- **Line 38 (`upload_video`)**: Receives the video via FastAPI's `UploadFile`. It creates a unique job ID and calls `asyncio.create_task(process_video(...))` to start processing without blocking the response.
- **Line 80 (`process_video`)**: The heart of the backend. It iterates through transcription chunks.
- **Line 88**: Uses `transcribe_video_stream` (from `whisper_service.py`) to get text segments and video duration.
- **Line 93**: Calls `add_furigana(seg["text"])` to get tokenized Japanese with reading aids.
- **Line 104**: Calls `translate_to_hindi(seg["text"])` for each segment.
- **Line 110**: Immediately appends processed chunks to `jobs[job_id]["result"]`, enabling real-time streaming to the frontend.

### **Frontend: `frontend/src/components/SubtitlePlayer.tsx`**
- **Line 39**: Calculates `activeSeg` (the current subtitle segment) by matching `currentTime` with the `start` and `end` timestamps of the segments.
- **Line 45 (`onTimeUpdate`)**: An event listener on the standard HTML5 `<video>` tag that updates the `currentTime` state every time the video position changes.
- **Line 92 (`lookupWord`)**: Triggered when a user clicks a word in the subtitle. It pauses the video and calls the backend `/dictionary/{word}` API.
- **Line 150**: The interactive mapping of subtitle tokens. Each word is wrapped in a `<span>` with an `onClick` for dictionary lookup.
- **Line 153-161**: Uses the `<ruby>` and `<rt>` HTML tags to render Furigana (reading characters) above the main text.

---

## 💡 5. Core Concepts for Clarity

- **"Interactive Subtitles":** Unlike standard `.srt` files, JapanEase subtitles are JSON objects containing metadata for every word. This allows for features like "Click to Define" or "Toggle Furigana."
- **"Polled Progress":** Because video processing takes time, the frontend doesn't stay stuck in a "waiting" state. It uses a progress bar (`0% to 100%`) updated by checking the backend every few seconds.
- **"Tokenization":** Japanese doesn't use spaces between words. `Fugashi` is used to "slice" a sentence like `私は学生です` into `私` (I), `は` (Topic marker), `学生` (Student), `です` (is).
- **"Furigana":** The small reading characters placed above Kanji. This is crucial for learners who know the meaning of a word but might not know its pronunciation.

---

## 🛠️ 6. Key API Endpoints

- `POST /upload`: Sends the video file. Returns a `job_id`.
- `GET /status/{job_id}`: Returns the current status (`queued`, `processing_chunks`, `completed`), progress percentage, and the array of processed subtitles.
- `GET /dictionary/{word}`: Returns definition and usage data for a specific Japanese word.
