"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Play, Download, Info, Layers, Clock, Loader2, X, Trash2, Quote } from "lucide-react";
import axios from "axios";
import Image from "next/image";
import SubtitlePlayer from "@/components/SubtitlePlayer";

const API_BASE = "http://localhost:8000";

type JobStatus = "idle" | "uploading" | "processing" | "transcribing" | "processing_chunks" | "done" | "error";

interface QuoteData {
  anime: string;
  character: string;
  quote: string;
}

interface FuriganaToken {
  surface: string;
  furigana: string | null;
  segments?: Array<{ text: string; f: string | null }>;
}

interface SubtitleSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  translation: string;
  furigana: FuriganaToken[];
}

interface LibraryItem {
  job_id: string;
  filename: string;
  video_url: string;
  target_lang: string;
  result: SubtitleSegment[];
}

interface UploadResponse {
  job_id: string;
}

interface StatusResponse {
  job_id: string;
  status: string;
  progress: number;
  result: SubtitleSegment[];
  video_url: string;
}

export default function Home() {
  const [status, setStatus] = useState<JobStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SubtitleSegment[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<"howItWorks" | "about" | "library" | null>(null);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [targetLang, setTargetLang] = useState<"hindi" | "english">("hindi");
  const [library, setLibrary] = useState<LibraryItem[]>([]);

  const requestRandomQuote = async (): Promise<QuoteData | null> => {
    try {
      const { data } = await axios.get<QuoteData[]>("/quotes.json");
      if (Array.isArray(data) && data.length > 0) {
        return data[Math.floor(Math.random() * data.length)];
      }
    } catch (error) {
      console.error("Failed to load quotes:", error);
    }

    return null;
  };

  const requestLibrary = async (): Promise<LibraryItem[]> => {
    try {
      const { data } = await axios.get<LibraryItem[]>(`${API_BASE}/library`);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Failed to fetch library:", error);
      return [];
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadInitialData = async () => {
      const [nextQuote, nextLibrary] = await Promise.all([
        requestRandomQuote(),
        requestLibrary(),
      ]);

      if (cancelled) {
        return;
      }

      if (nextQuote) {
        setQuote(nextQuote);
      }
      setLibrary(nextLibrary);
    };

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeModal !== "library") {
      return;
    }

    let cancelled = false;

    const loadLibrary = async () => {
      const nextLibrary = await requestLibrary();
      if (!cancelled) {
        setLibrary(nextLibrary);
      }
    };

    void loadLibrary();

    return () => {
      cancelled = true;
    };
  }, [activeModal]);

  useEffect(() => {
    return () => {
      if (videoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  const refreshRandomQuote = async () => {
    const nextQuote = await requestRandomQuote();
    if (nextQuote) {
      setQuote(nextQuote);
    }
  };

  const openLibrary = async () => {
    setActiveModal("library");
    setLibrary(await requestLibrary());
  };

  const loadFromLibrary = (item: LibraryItem) => {
    const rawUrl = item.video_url;
    const encodedUrl = rawUrl.includes("%") ? rawUrl : encodeURI(rawUrl);
    setVideoUrl(`${API_BASE}${encodedUrl}`);
    setResult(item.result || []);
    setJobId(item.job_id);
    setStatus("done");
    setActiveModal(null);
  };

  const deleteFromLibrary = async (targetJobId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!confirm("Are you sure you want to remove this video from your library? This cannot be undone.")) {
      return;
    }

    try {
      await axios.delete(`${API_BASE}/library/${targetJobId}`);
      setLibrary((prev) => prev.filter((item) => item.job_id !== targetJobId));
    } catch (error) {
      console.error("Delete Error:", error);
      alert("Failed to delete video.");
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    setStatus("uploading");
    setVideoUrl((prevUrl) => {
      if (prevUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(prevUrl);
      }
      return URL.createObjectURL(selectedFile);
    });

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("target_lang", targetLang);

    try {
      const { data } = await axios.post<UploadResponse>(`${API_BASE}/upload`, formData);
      setJobId(data.job_id);
      setStatus("processing");
    } catch (error) {
      console.error(error);
      setStatus("error");
    }
  };

  useEffect(() => {
    if (!jobId || status === "done" || status === "error") {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const { data } = await axios.get<StatusResponse>(`${API_BASE}/status/${jobId}`);
        setProgress(data.progress);
        setResult(data.result || []);

        if (data.status === "done" || data.status === "completed" || data.progress === 100) {
          setStatus("done");
          clearInterval(interval);
        } else if (typeof data.status === "string" && data.status.startsWith("failed")) {
          setStatus("error");
          clearInterval(interval);
        } else if (data.status === "processing_chunks") {
          setStatus("processing_chunks");
        } else if (data.status === "transcribing") {
          setStatus("transcribing");
        } else if (data.status === "error") {
          setStatus("error");
          clearInterval(interval);
        }
      } catch (error) {
        console.error(error);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [status, jobId]);

  const downloadAss = () => {
    if (result.length === 0) {
      return;
    }

    let ass = "[Script Info]\nTitle: JapanEase Auto-Generated\nScriptType: v4.00+\nPlayResX: 384\nPlayResY: 288\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,16,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,1,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";

    result.forEach((seg) => {
      const start = new Date(seg.start * 1000).toISOString().substr(11, 8) + ".00";
      const end = new Date(seg.end * 1000).toISOString().substr(11, 8) + ".00";
      ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,${seg.text}\n`;
    });

    const blob = new Blob([ass], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "subtitles.ass";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-orange-500/30 flex flex-col justify-between">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-zinc-600/10 rounded-full blur-[120px]" />
      </div>

      <nav className="relative z-10 p-6 flex justify-between items-center border-b border-zinc-800/60 backdrop-blur-md bg-zinc-950/50">
        <div className="flex items-center gap-3">
          <div className="relative w-12 h-12 overflow-hidden rounded-xl border border-orange-500/50 shadow-lg shadow-orange-500/20 bg-zinc-900 flex items-center justify-center">
            <Image
              src="/toji.jpg"
              alt="JapanEase Toji Logo"
              fill
              sizes="48px"
              className="object-cover object-top transition-opacity duration-300"
              priority
            />
          </div>
          <span className="text-xl font-bold tracking-tight text-zinc-100">
            japanEase <span className="text-orange-400 italic font-medium">AI</span>
          </span>
        </div>
        <div className="flex gap-6 text-sm font-medium text-zinc-400">
          <button
            onClick={() => {
              void openLibrary();
            }}
            className="flex items-center gap-2 hover:text-orange-400 transition-colors bg-zinc-900 px-4 py-2 rounded-xl border border-zinc-800"
          >
            <Layers size={16} /> My Library
          </button>
          <button onClick={() => setActiveModal("howItWorks")} className="hover:text-zinc-100 transition-colors">
            How it works
          </button>
          <button onClick={() => setActiveModal("about")} className="hover:text-zinc-100 transition-colors">
            About
          </button>
        </div>
      </nav>

      <section className="relative z-10 max-w-6xl mx-auto px-6 py-16 flex-grow flex flex-col justify-center">
        {status === "idle" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center text-center space-y-8"
          >
            <div className="space-y-4 max-w-2xl">
              <h1 className="text-5xl md:text-6xl font-extrabold leading-[1.1] tracking-tighter text-zinc-100">
                Transform any video into an{" "}
                <span className="bg-gradient-to-r from-orange-400 via-orange-300 to-zinc-300 bg-clip-text text-transparent">
                  Interactive Mastery Experience
                </span>
              </h1>
              <p className="text-xl text-zinc-400 font-medium">
                AI-powered subtitles with Hindi translation, Kanji readings, and contextual dictionary. Learn Japanese while watching what you love.
              </p>
            </div>

            {quote && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                key={quote.quote}
                className="w-full max-w-xl p-6 bg-zinc-900/50 rounded-3xl border border-zinc-800 backdrop-blur-sm relative overflow-hidden group shadow-xl shadow-orange-500/5"
              >
                <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Quote size={48} className="text-orange-400" />
                </div>
                <div className="space-y-4">
                  <p className="text-zinc-200 text-lg md:text-xl font-medium leading-relaxed italic">
                    &ldquo;{quote.quote}&rdquo;
                  </p>
                  <div className="flex justify-between items-end">
                    <div className="text-left">
                      <p className="text-orange-400 font-bold">{quote.character}</p>
                      <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">{quote.anime}</p>
                    </div>
                    <button
                      onClick={() => {
                        void refreshRandomQuote();
                      }}
                      className="px-4 py-2 bg-orange-600/10 hover:bg-orange-600/20 text-orange-400 text-xs font-bold rounded-lg border border-orange-500/20 transition-all flex items-center gap-2 group-active:scale-95"
                    >
                      <Layers size={14} className="animate-pulse" /> Change Quote
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            <div className="flex bg-zinc-900/80 p-1.5 rounded-2xl border border-zinc-800 shadow-inner group/lang scale-105 active:scale-100 transition-transform">
              <button
                onClick={() => setTargetLang("hindi")}
                className={`px-8 py-3 rounded-xl text-sm font-bold transition-all duration-300 flex items-center gap-2 ${
                  targetLang === "hindi"
                    ? "bg-orange-600 text-white shadow-[0_4px_20px_rgba(234,88,12,0.3)] scale-105"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Hindi
                {targetLang === "hindi" && <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
              </button>
              <button
                onClick={() => setTargetLang("english")}
                className={`px-8 py-3 rounded-xl text-sm font-bold transition-all duration-300 flex items-center gap-2 ${
                  targetLang === "english"
                    ? "bg-orange-600 text-white shadow-[0_4px_20px_rgba(234,88,12,0.3)] scale-105"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                English
                {targetLang === "english" && <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
              </button>
            </div>

            <label className="group relative cursor-pointer w-full max-w-xl h-64 border-2 border-dashed border-zinc-700 rounded-3xl flex flex-col items-center justify-center hover:border-orange-500/60 hover:bg-orange-500/5 transition-all duration-300 bg-zinc-900/30">
              <input type="file" className="hidden" accept="video/*" onChange={handleUpload} />
              <div className="p-5 bg-zinc-800/50 rounded-2xl group-hover:scale-110 shadow-lg transition-all duration-300 group-hover:shadow-orange-500/20">
                <Upload className="text-orange-400" size={32} />
              </div>
              <div className="mt-4 text-lg font-semibold text-zinc-300">
                Drop your video here or <span className="text-orange-400">browse</span>
              </div>
              <div className="text-zinc-500 text-sm mt-1 font-medium">MP4, MKV supported. Max 200MB.</div>
            </label>
          </motion.div>
        )}

        {(status === "processing" || status === "transcribing" || (status === "processing_chunks" && result.length === 0)) && (
          <div className="flex flex-col items-center justify-center space-y-8 max-w-2xl mx-auto">
            <div className="relative w-32 h-32">
              <Loader2 className="w-full h-full text-orange-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center text-xl font-bold font-mono">
                {progress}%
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-bold text-zinc-100">
                {status === "transcribing" ? "Transcribing audio..." : "Translating subtitles..."}
              </h3>
              <p className="text-zinc-500 font-medium tracking-wide">
                {status === "transcribing"
                  ? "Whisper AI is extracting Japanese speech. This takes 30-90 seconds."
                  : "Each sentence is translated and added to the transcript live."}
              </p>
            </div>
            <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden border border-zinc-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                className="h-full bg-gradient-to-r from-orange-600 to-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.4)]"
              />
            </div>
          </div>
        )}

        {(status === "done" || (status === "processing_chunks" && result.length > 0)) && videoUrl && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
            {status === "processing_chunks" && (
              <div className="bg-orange-500/10 border border-orange-500/20 p-4 rounded-2xl flex items-center gap-3 text-orange-400 font-bold text-sm shadow-lg shadow-orange-500/5">
                <Loader2 className="animate-spin text-orange-400" size={18} />
                Processing: {progress}% Complete...
              </div>
            )}
            <SubtitlePlayer
              videoUrl={videoUrl}
              segments={result}
              setSegments={setResult}
              jobId={jobId}
            />
            <div className="flex justify-between items-center p-6 bg-zinc-900/50 backdrop-blur-md rounded-3xl border border-zinc-800 shadow-xl">
              <div className="flex gap-4">
                <button
                  onClick={downloadAss}
                  className="flex items-center gap-2 px-6 py-3 bg-orange-600 rounded-xl hover:bg-orange-500 active:scale-95 transition-all font-semibold shadow-lg shadow-orange-500/20 text-zinc-50"
                >
                  <Download size={18} /> Download Subtitles (.ass)
                </button>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setActiveModal("about")}
                  className="p-3 bg-zinc-800/80 text-orange-400 rounded-xl hover:bg-zinc-700 transition-colors tooltip shadow-inner border border-zinc-700"
                  aria-label="Information"
                >
                  <Info size={20} />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <AnimatePresence>
        {activeModal === "library" && (
          <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-md z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-2xl w-full shadow-2xl space-y-6 shadow-orange-900/10 max-h-[80vh] flex flex-col"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-3xl font-bold bg-gradient-to-r from-orange-400 via-orange-300 to-zinc-200 bg-clip-text text-transparent">
                  My Library
                </h2>
                <button onClick={() => setActiveModal(null)} className="p-2 hover:bg-white/10 rounded-full transition-all">
                  <X size={24} />
                </button>
              </div>

              <div className="overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-zinc-700">
                {library.length > 0 ? (
                  library.map((item) => (
                    <div
                      key={item.job_id}
                      onClick={() => loadFromLibrary(item)}
                      className="group flex flex-col p-4 bg-zinc-800/40 border border-zinc-700/50 rounded-2xl hover:border-orange-500/50 hover:bg-zinc-800/80 cursor-pointer transition-all active:scale-[0.98]"
                    >
                      <div className="flex justify-between items-center group">
                        <div className="flex flex-col flex-grow">
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-lg font-bold text-zinc-100 group-hover:text-orange-400 truncate max-w-[80%]">
                              {item.filename}
                            </span>
                            <span className="px-2 py-0.5 bg-zinc-700 text-zinc-400 text-[10px] font-black uppercase tracking-widest rounded-md border border-zinc-600">
                              ID: {item.job_id.slice(0, 8)}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-zinc-500 font-medium tracking-tight">
                            <span className="flex items-center gap-1">
                              <Clock size={12} /> {(item.result || []).length} Subtitle Lines
                            </span>
                            <span className="capitalize px-1.5 py-0.5 bg-orange-500/10 text-orange-400 rounded-md border border-orange-500/20">
                              {item.target_lang}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={(event) => {
                            void deleteFromLibrary(item.job_id, event);
                          }}
                          className="ml-4 p-3 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                          title="Delete from library"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-12 text-center text-zinc-500 space-y-3">
                    <Layers size={48} className="mx-auto opacity-20" />
                    <p className="font-medium">
                      No videos found in your library yet. <br />
                      Upload a video to get started!
                    </p>
                  </div>
                )}
              </div>

              <button
                onClick={() => setActiveModal(null)}
                className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 rounded-xl font-bold transition-all"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}

        {activeModal === "howItWorks" && (
          <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-md z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-lg w-full shadow-2xl space-y-6 shadow-orange-900/10"
            >
              <h2 className="text-3xl font-bold bg-gradient-to-r from-orange-400 via-orange-300 to-zinc-200 bg-clip-text text-transparent font-display">
                How it works
              </h2>
              <div className="space-y-4 text-zinc-300">
                <p>1. <strong className="text-zinc-100">Upload Video:</strong> Drop your local Japanese MP4 anime/video file.</p>
                <p>2. <strong className="text-zinc-100">AI Engine Processing:</strong> The CTranslate Whisper neural network parses the audio into native Japanese text on the fly.</p>
                <p>3. <strong className="text-zinc-100">Furigana Injection:</strong> Fugashi tokenizer tags each Kanji with proper Hiragana reading strokes.</p>
                <p>4. <strong className="text-zinc-100">Mistral Translation:</strong> The AI model processes exact translation mappings locally.</p>
                <p>5. <strong className="text-zinc-100">Interactive Viewing:</strong> The player drops down automatically - click any Kanji inside the video player to load an instant dictionary definition while the video auto-pauses.</p>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 rounded-xl font-bold transition-all"
              >
                Got it!
              </button>
            </motion.div>
          </div>
        )}

        {activeModal === "about" && (
          <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-md z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-6 text-center shadow-orange-900/10"
            >
              <div className="mx-auto w-16 h-16 bg-gradient-to-tr from-orange-500 to-zinc-400 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-500/20">
                <Play className="fill-zinc-50" size={32} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-zinc-100 font-display">
                  JapanEase <span className="text-orange-400 italic">AI</span>
                </h2>
                <p className="text-sm text-zinc-500 mt-1">Version 1.0.0 (Local Build)</p>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Built to make learning Japanese through native anime & drama as seamless and immersive as watching Netflix natively.
              </p>
              <button
                onClick={() => setActiveModal(null)}
                className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-zinc-50 rounded-xl font-bold transition-all shadow-lg shadow-orange-500/20"
              >
                Close Preview
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="relative z-10 border-t border-zinc-900 py-6 mt-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-xs md:text-sm text-zinc-600 font-medium tracking-wide">
          <p className="mb-1">
            <span className="text-zinc-500 font-semibold">&copy; {new Date().getFullYear()} JapanEase AI.</span> Open-source & Free Software.
          </p>
          <p>Feel free to use, modify, or distribute without claiming ownership. Attribution is appreciated but not required!</p>
        </div>
      </footer>
    </main>
  );
}
