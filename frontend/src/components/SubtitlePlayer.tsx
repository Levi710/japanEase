import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, 
  Settings, X, Search, Clock, Save, Check, AlertCircle, Repeat,
  ExternalLink, RefreshCw
} from 'lucide-react';
import axios from 'axios';
import { useSavedWords } from '../hooks/useSavedWords';
import { saveToNotion } from '../lib/notionService';
import type { DictData } from '../lib/notionService';

const API_BASE = "http://localhost:8000";

interface SubtitleSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  translation: string;
  furigana: Array<{
    surface: string;
    furigana: string | null;
    segments?: Array<{ text: string; f: string | null }>;
  }>;
}

interface DictExample {
  jp: string;
  hi: string;
}

interface SelectedWordState {
  word: string;
  reading?: string | null;
  romaji?: string;
  meaning?: string[] | string;
  meaning_en?: string;
  meaning_hi?: string;
  is_rich?: boolean;
  examples?: DictExample[];
  jlpt?: string | null;
  context_reading?: string;
  base_form?: string;
  base_reading?: string;
  notion_url?: string;
  loading: boolean;
}

type ViewMode = 'beginner' | 'intermediate' | 'advanced';

export default function SubtitlePlayer({ 
  videoUrl, 
  segments, 
  setSegments,
  jobId
}: { 
  videoUrl: string, 
  segments: SubtitleSegment[],
  setSegments: (s: SubtitleSegment[]) => void,
  jobId: string | null
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mode, setMode] = useState<ViewMode>('beginner');
  const [selectedWord, setSelectedWord] = useState<SelectedWordState | null>(null);
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 });
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [subtitlePosition, setSubtitlePosition] = useState<'bottom' | 'top'>('bottom');
  const [loopSegmentId, setLoopSegmentId] = useState<string | null>(null);
  const [subOffset, setSubOffset] = useState(0); // Offset in seconds
  const [isManualScrolling, setIsManualScrolling] = useState(false);
  const [syncSuccessIdx, setSyncSuccessIdx] = useState<number | null>(null);
  const [localSegments, setLocalSegments] = useState<SubtitleSegment[]>(segments);

  // Sync local segments when prop changes (e.g. initial load or library switch)
  useEffect(() => {
    setLocalSegments(segments);
  }, [segments]);
  
  // Mem MCP State
  const { savedWords, isSaved, markSaved, syncFromNotion, getNotionUrl } = useSavedWords();
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // AUTO-SYNC ON MOUNT
  useEffect(() => {
    syncFromNotion(API_BASE);
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeSegRef = useRef<SubtitleSegment | null>(null);
  const isLoopingRef = useRef(false);
  const loopSegmentIdRef = useRef<string | null>(null);
  const subOffsetRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const localSegmentsRef = useRef<SubtitleSegment[]>(localSegments);

  const handleSyncNotion = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIsSyncing(true);
    await syncFromNotion(API_BASE);
    setIsSyncing(false);
  };

  const activeSeg = useMemo(() => 
    [...localSegments].reverse().find(s => (currentTime - subOffset) >= s.start && (currentTime - subOffset) <= s.end), 
    [localSegments, currentTime, subOffset]
  );

  // Sync Refs to avoid stale closures in event listeners without re-registering them
  useEffect(() => { activeSegRef.current = activeSeg || null; }, [activeSeg]);
  useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);
  useEffect(() => { loopSegmentIdRef.current = loopSegmentId; }, [loopSegmentId]);
  useEffect(() => { subOffsetRef.current = subOffset; }, [subOffset]);
  useEffect(() => { localSegmentsRef.current = localSegments; }, [localSegments]);

  // AUTO-SCROLL TRANSCRIPT (INTERNAL ONLY - NO PAGE YANKING)
  useEffect(() => {
    if (activeSeg && transcriptRef.current && !isManualScrolling) {
      const container = transcriptRef.current;
      const element = document.getElementById(`seg-${activeSeg.id}`);
      
      if (element && container) {
        const targetScroll = element.offsetTop - (container.offsetHeight / 2) + (element.offsetHeight / 2);
        container.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
      }
    }
  }, [activeSeg, isManualScrolling]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let rafId: number;
    
    const checkTime = () => { 
      const now = v.currentTime;
      setCurrentTime(now); 
      
      // Loop Logic using Refs to avoid stale closure or dependency re-runs
      // Apply offset to the check so the loop matches the visuals
      const adjustedTime = now - subOffsetRef.current;
      
      // IF specific segment is selected for looping, use its boundaries
      // ELSE use the active segment detected by time
      const targetSeg = loopSegmentIdRef.current 
        ? localSegmentsRef.current.find(s => s.id === loopSegmentIdRef.current)
        : activeSegRef.current;

      if (isLoopingRef.current && targetSeg && adjustedTime >= targetSeg.end) {
        v.currentTime = targetSeg.start + subOffsetRef.current;
      }
      
      rafId = requestAnimationFrame(checkTime); 
    };

    const onDuration = () => setDuration(v.duration);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    v.addEventListener('durationchange', onDuration);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    
    rafId = requestAnimationFrame(checkTime);

    return () => {
      cancelAnimationFrame(rafId);
      v.removeEventListener('durationchange', onDuration);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, []); // Run ONLY once on mount

  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = playbackRate; }, [playbackRate]);

  const togglePlay = () => videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause();
  const toggleMute = () => { if (videoRef.current) { videoRef.current.muted = !videoRef.current.muted; setIsMuted(videoRef.current.muted); } };
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) { containerRef.current?.requestFullscreen(); setIsFullscreen(true); } 
    else { document.exitFullscreen(); setIsFullscreen(false); }
  };
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (videoRef.current) { videoRef.current.currentTime = t; setCurrentTime(t); }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      switch(e.key.toLowerCase()) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'l': setIsLooping(prev => !prev); break;
        case 'f': toggleFullscreen(); break;
        case 'm': toggleMute(); break;
        case '[': setSubOffset(prev => Math.round((prev - 0.1) * 10) / 10); break;
        case ']': setSubOffset(prev => Math.round((prev + 0.1) * 10) / 10); break;
        case 's': {
          // SNAP SYNC: Find the NEAREST segment start and align it to current time
          const current = videoRef.current?.currentTime || 0;
          const closest = localSegmentsRef.current
            .filter(s => Math.abs(s.start - current) < 10)
            .sort((a, b) => Math.abs(a.start - current) - Math.abs(b.start - current))[0];
          
          if (closest) {
            setSubOffset(Math.round((current - closest.start) * 10) / 10);
          }
          break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, isMuted, isFullscreen, isLooping]);

  const toggleLineLoop = (idx: number) => {
    const seg = localSegments[idx];
    if (!seg) return;
    
    if (loopSegmentId === seg.id) {
      // De-select if same line
      setLoopSegmentId(null);
      setIsLooping(false);
    } else {
      // Jump and Loop
      if (videoRef.current) videoRef.current.currentTime = seg.start + subOffset;
      setLoopSegmentId(seg.id);
      setIsLooping(true);
      if (!isPlaying) togglePlay();
    }
  };

  const shiftTranscript = (targetIdx: number) => {
    if (!videoRef.current) return;
    
    // Use the raw video time for the new sync point
    const vTime = videoRef.current.currentTime; 
    const targetSeg = localSegments[targetIdx];
    
    // We want the new internal 'start' to be vTime
    // But since we are 'hard-aligning', we also reset the manual offset to 0
    const delta = vTime - targetSeg.start;

    // Shift this line and all following lines
    const updated = localSegments.map((s, idx) => {
      if (idx >= targetIdx) {
        return { ...s, start: s.start + delta, end: s.end + delta };
      }
      return s;
    });

    setLocalSegments(updated); // Update locally for INSTANT jump response
    setSegments(updated);      // Update parent for global consistency
    setSubOffset(0);           // CLEAR manual offset to "bake" the new sync
    setSyncSuccessIdx(targetIdx);
    
    // PERSIST TO LIBRARY (Save for refresh)
    if (jobId) {
      axios.put(`${API_BASE}/library/${jobId}/segments`, { segments: updated })
        .catch(err => console.error("Auto-Save Failed:", err));
    }

    setTimeout(() => setSyncSuccessIdx(null), 1500);
    console.log(`Cascading Sync Success: Shifted ${localSegments.length - targetIdx} lines by ${delta.toFixed(3)}s. Offset Reset to 0.`);
  };

  const lookupWord = async (word: string, reading: string | null | undefined, e: React.MouseEvent) => {
    if (videoRef.current) videoRef.current.pause();
    setSaveStatus('idle');

    // GET BOUNDS FOR RELATIVE POSITIONING
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setPopupPos({ x, y: y - 20 });
    }

    setSelectedWord({ word, loading: true, reading });
    try {
      const url = `${API_BASE}/dictionary/${encodeURIComponent(word)}${reading ? `?reading=${encodeURIComponent(reading)}` : ''}`;
      const r = await axios.get<SelectedWordState>(url);
      setSelectedWord({ ...r.data, loading: false });
    } catch { setSelectedWord({ word, reading, meaning: ["(word unknown)"], loading: false }); }
  };

  const handleSaveWord = async () => {
    if (!selectedWord || selectedWord.loading || isSaving) return;
    
    setIsSaving(true);
    setSaveStatus('idle');
    try {
      // FETCH RICH DATA ON-DEMAND (With precise context from subtitle)
      const url = `${API_BASE}/dictionary/rich/${encodeURIComponent(selectedWord.word)}${selectedWord.reading ? `?reading=${encodeURIComponent(selectedWord.reading)}` : ''}`;
      const richRes = await axios.get<DictData>(url);
      const richData = richRes.data;

      // SAVE TO NOTION
      const notionRes = await saveToNotion(richData, "JapanEase AI Demo");
      const notionUrl = notionRes.data?.url || notionRes.url;
      
      markSaved(selectedWord.word, notionUrl);
      setSaveStatus('success');
      
      // Update UI with rich data and Notion URL
      setSelectedWord({ ...richData, notion_url: notionUrl, loading: false });
    } catch (err) {
      console.error("Notion Save Error:", err);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };
  const formatTime = (t: number) => {
    const m = Math.floor(t / 60); const s = Math.floor(t % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };
  const seekPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="max-w-[1280px] mx-auto space-y-6 select-none p-2">
      {/* VIDEO CONTAINER */}
      <div 
        ref={containerRef}
        onMouseMove={() => { setShowControls(true); if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); controlsTimeoutRef.current = setTimeout(() => isPlaying && setShowControls(false), 3000); }}
        className="relative aspect-video bg-black rounded-[2rem] md:rounded-[3rem] overflow-hidden shadow-2xl group border border-white/5"
      >
        <video ref={videoRef} src={videoUrl} className="w-full h-full object-contain cursor-pointer" onClick={togglePlay} />

        {/* SUBTITLES - BALANCED & CONTROLLED SIZE */}
        <AnimatePresence mode="wait">
          {activeSeg && (
            <motion.div
              key={activeSeg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`absolute left-0 right-0 px-10 md:px-20 flex flex-col items-center gap-1 md:gap-3 z-40 transition-all duration-300 pointer-events-none ${
                subtitlePosition === 'top' 
                ? 'top-12 md:top-24' 
                : (showControls ? "bottom-36 md:bottom-48" : "bottom-12 md:bottom-24")
              }`}
            >
              <div className="flex flex-wrap justify-center items-end gap-x-1 md:gap-x-2 pointer-events-auto max-w-full">
                {activeSeg.furigana.map((t, i) => (
                  <button 
                    key={i} 
                    onClick={(e) => lookupWord(t.surface, t.furigana, e)} 
                    className={`group relative flex flex-col items-center transition-all hover:scale-110 active:scale-95 px-1.5 py-1 rounded-xl ${isSaved(t.surface) ? 'bg-green-500/10 ring-1 ring-green-500/30' : ''}`}
                  >
                    <ruby 
                      style={{ fontSize: 'clamp(1rem, 2.8vw, 2.6rem)' }} 
                      className="font-black text-white [text-shadow:_-1.5px_-1.5px_0_#000,1.5px_-1.5px_0_#000,-1.5px_1.5px_0_#000,1.5px_1.5px_0_#000] leading-none drop-shadow-2xl"
                    >
                      {mode !== 'advanced' && t.segments ? (
                        t.segments.map((s, si) => (
                          <React.Fragment key={si}>
                            {s.text}
                            {s.f && (
                              <rt style={{ 
                                fontSize: 'clamp(0.4rem, 0.9vw, 0.75rem)',
                                rubyPosition: 'over'
                              }} className={`font-bold tracking-widest [text-shadow:_-1px_-1px_0_#000,1px_-1px_0_#000,-1px_1px_0_#000,1px_1px_0_#000] mb-1 select-none whitespace-nowrap drop-shadow-md ${isSaved(t.surface) ? 'text-green-400' : 'text-orange-500'}`}>
                                {s.f}
                              </rt>
                            )}
                          </React.Fragment>
                        ))
                      ) : (
                        mode !== 'advanced' && t.furigana ? (
                          <>
                            <rt style={{ 
                              fontSize: 'clamp(0.4rem, 0.9vw, 0.75rem)',
                              rubyPosition: 'over'
                            }} className={`font-bold tracking-widest [text-shadow:_-1px_-1px_0_#000,1px_-1px_0_#000,-1px_1px_0_#000,1px_1px_0_#000] mb-1 select-none whitespace-nowrap drop-shadow-md ${isSaved(t.surface) ? 'text-green-400' : 'text-orange-500'}`}>
                              {t.furigana}
                            </rt>
                            {t.surface}
                          </>
                        ) : t.surface
                      )}
                    </ruby>
                  </button>
                ))}
              </div>
              {mode === 'beginner' && activeSeg.translation && (
                <p style={{ fontSize: 'clamp(0.7rem, 1.25vw, 1.1rem)' }} className="max-w-[80%] text-center text-zinc-300 font-bold tracking-tight drop-shadow-[0_4px_10px_rgba(0,0,0,1)] [text-shadow:_-1px_-1px_0_#000,1px_-1px_0_#000,-1px_1px_0_#000,1px_1px_0_#000]">{activeSeg.translation}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- CONTROLS OVERLAY --- */}
        <motion.div 
          animate={{ opacity: showControls ? 1 : 0, y: showControls ? 0 : 50 }}
          className="absolute bottom-0 left-0 right-0 p-6 md:p-10 pb-8 bg-gradient-to-t from-black via-black/60 to-transparent flex flex-col gap-6 z-50"
        >
          {/* PRECISION PROGRESS BAR */}
          <div className="w-full px-2">
            <input 
              type="range" min={0} max={duration || 100} step="0.01" value={currentTime} onChange={handleSeek}
              className="w-full h-1.5 md:h-2 bg-white/20 rounded-full appearance-none cursor-pointer accent-orange-600 hover:accent-orange-500 transition-all"
              style={{
                background: `linear-gradient(to right, #ea580c ${seekPercent}%, rgba(255,255,255,0.1) ${seekPercent}%)`
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-x-2">
            {/* L: Playback */}
            <div className="flex items-center gap-2 md:gap-4">
              <button onClick={togglePlay} className="text-white hover:text-orange-500 active:scale-95 transition-all outline-none">
                {isPlaying ? <Pause size={24} className="md:w-8 md:h-8" fill="currentColor" /> : <Play size={24} className="md:w-8 md:h-8" fill="currentColor" />}
              </button>
              
              <button 
                onClick={() => setIsLooping(!isLooping)} 
                className={`p-1.5 md:p-2 rounded-lg md:rounded-xl transition-all outline-none ${isLooping ? 'bg-orange-600 text-white shadow-lg' : 'text-zinc-500 hover:text-white bg-white/5'}`}
                title="Loop current sentence (L)"
              >
                <Repeat size={18} className="md:w-5 md:h-5" />
              </button>

              <div className="flex items-center gap-3 md:gap-4 px-4 py-2 md:px-6 md:py-3 bg-white/5 border border-white/5 rounded-2xl text-xs md:text-lg font-black text-zinc-400">
                <button onClick={toggleMute} className="hover:text-white transition-colors">
                   {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
                <div className="flex gap-2 tabular-nums">
                  <span className="text-zinc-200">{formatTime(currentTime)}</span>
                  <span className="opacity-10">/</span>
                  <span className="opacity-40">{formatTime(duration)}</span>
                </div>
              </div>
            </div>

            {/* R: Level & Settings */}
            <div className="flex items-center gap-1 md:gap-4">
              <div className="flex bg-black/40 p-0.5 md:p-1 rounded-xl border border-white/10 shrink-0">
                 {['beginner', 'intermediate', 'advanced'].map(lvl => (
                   <button key={lvl} onClick={() => setMode(lvl as ViewMode)} 
                           className={`px-2 py-1 md:px-4 md:py-2 rounded-lg text-[9px] md:text-xs font-black uppercase tracking-widest ${mode === lvl ? 'bg-orange-600 text-white shadow-xl' : 'text-zinc-600 hover:text-zinc-200'}`}>
                     <span className="hidden lg:inline">{lvl}</span>
                     <span className="lg:hidden">{lvl.charAt(0)}</span>
                   </button>
                 ))}
              </div>
              
              <div className="relative">
                <button onClick={() => setShowSettings(!showSettings)} className={`p-2 md:p-3 rounded-lg md:rounded-xl border transition-all outline-none ${showSettings ? 'bg-orange-600 text-white shadow-xl' : 'bg-white/5 text-zinc-500 hover:text-white border-white/5'}`}>
                  <Settings size={18} className={`md:w-5 md:h-5 ${showSettings ? 'animate-spin-slow' : ''}`} />
                </button>
                <AnimatePresence>
                  {showSettings && (
                    <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                className="absolute bottom-full right-0 mb-6 w-56 bg-zinc-900 border border-white/10 rounded-2xl p-5 shadow-2xl z-[100] flex flex-col gap-4">
                      
                      <div className="flex flex-col gap-2">
                        <p className="text-[10px] uppercase font-black text-zinc-600 text-center tracking-widest">Sync Subtitles</p>
                        <div className="flex flex-col items-center gap-2 bg-white/5 p-3 rounded-xl">
                          <span className="text-xs font-bold text-orange-500">{subOffset > 0 ? '+' : ''}{subOffset.toFixed(1)}s</span>
                          <input 
                            type="range" min="-10" max="10" step="0.1" 
                            value={subOffset} 
                            onChange={(e) => setSubOffset(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-orange-500"
                          />
                          <div className="flex gap-4">
                            <button onClick={() => setSubOffset(0)} className="text-[9px] text-zinc-500 hover:text-white uppercase font-bold tracking-tighter">Reset</button>
                            <button 
                              onClick={() => {
                                const current = videoRef.current?.currentTime || 0;
                                const closest = localSegments
                                  .filter(s => Math.abs(s.start - current) < 10)
                                  .sort((a, b) => Math.abs(a.start - current) - Math.abs(b.start - current))[0];
                                if (closest) setSubOffset(Math.round((current - closest.start) * 10) / 10);
                              }}
                              className="text-[9px] text-orange-500 hover:text-white uppercase font-bold tracking-tighter"
                            >
                              Snap to Voice (S)
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
                        <p className="text-[10px] uppercase font-black text-zinc-600 text-center tracking-widest">Speed</p>
                        <div className="grid grid-cols-2 gap-1">
                          {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => (
                            <button key={r} onClick={() => { setPlaybackRate(r); setShowSettings(false); }}
                                    className={`p-2 rounded-xl text-sm font-bold transition-all ${playbackRate === r ? 'bg-orange-600 text-white' : 'text-zinc-500 hover:bg-white/5 hover:text-white'}`}>
                              {r}x
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
                        <p className="text-[10px] uppercase font-black text-zinc-600 text-center tracking-widest">Subtitle Position</p>
                        <div className="flex gap-1 bg-white/5 p-1 rounded-xl">
                          {(['bottom', 'top'] as const).map(pos => (
                            <button 
                              key={pos} 
                              onClick={() => setSubtitlePosition(pos)}
                              className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${subtitlePosition === pos ? 'bg-orange-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-200'}`}
                            >
                              {pos}
                            </button>
                          ))}
                        </div>
                      </div>

                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button onClick={toggleFullscreen} className="flex p-2 md:p-3 rounded-lg md:rounded-xl bg-white/5 border border-white/5 text-zinc-500 hover:text-white transition-all outline-none">
                 {isFullscreen ? <Minimize size={18} className="md:w-5 md:h-5" /> : <Maximize size={18} className="md:w-5 md:h-5" />}
              </button>
            </div>
          </div>
        </motion.div>

        {/* --- DICTIONARY OVERLAY (Intelligent Anchor Positioning) --- */}
        <AnimatePresence>
          {selectedWord && (
            <>
              {/* Invisible Backdrop for easy closing */}
              <div 
                className="absolute inset-0 z-[90] cursor-pointer pointer-events-auto bg-black/10 backdrop-blur-[2px]" 
                onClick={() => setSelectedWord(null)} 
              />
              
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                drag
                dragConstraints={containerRef}
                dragMomentum={false}
                style={{
                  top: `${Math.max(40, popupPos.y - 15)}px`,
                  left: `${Math.max(140, Math.min((containerRef.current?.offsetWidth || 0) - 140, popupPos.x))}px`,
                  transform: 'translate(-50%, -100%)'
                }}
                className="absolute z-[100] cursor-grab active:cursor-grabbing"
              >
                <div className="bg-[#09090b]/98 backdrop-blur-3xl border border-white/20 rounded-[1.2rem] md:rounded-[1.5rem] p-4 md:p-5 shadow-[0_30px_70px_rgba(0,0,0,1)] relative min-w-[260px] max-w-[85vw] md:max-w-md w-fit h-auto pointer-events-auto overflow-hidden">
                  <button 
                    onClick={() => setSelectedWord(null)} 
                    className="absolute top-2 right-2 p-1 hover:bg-white/10 rounded-full text-zinc-600 hover:text-white transition-all active:scale-90"
                  >
                    <X size={18} />
                  </button>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xl md:text-2xl font-black text-white tracking-tighter leading-tight drop-shadow-sm">{selectedWord.word}</h3>
                        <a 
                          href={`https://jisho.org/search/${encodeURIComponent(selectedWord.word)}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-500 hover:text-orange-500 transition-all flex items-center gap-1.5"
                          title="View on Jisho.org"
                        >
                          <span className="text-[10px] font-black uppercase tracking-tighter hidden sm:inline">Jisho</span>
                          <ExternalLink size={14} />
                        </a>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {!selectedWord.loading && <span className="text-[10px] md:text-xs font-bold text-orange-500/90 tracking-widest uppercase italic">{selectedWord.reading} {selectedWord.romaji && `(${selectedWord.romaji})`}</span>}
                        {selectedWord.context_reading && selectedWord.context_reading !== selectedWord.reading && (
                          <span className="text-[8px] bg-white/5 px-1.5 py-0.5 rounded text-zinc-500 font-bold uppercase tracking-tighter">In video: {selectedWord.context_reading}</span>
                        )}
                        <div className="flex gap-1">
                          {selectedWord.jlpt && selectedWord.jlpt !== 'unknown' && <span className="px-1.5 py-0.5 bg-blue-500/20 border border-blue-500/30 text-blue-400 text-[8px] uppercase font-black rounded italic">{selectedWord.jlpt}</span>}
                        </div>
                      </div>
                      {selectedWord.base_form && selectedWord.base_form !== selectedWord.word && (
                        <div className="mt-1 flex items-center gap-1.5 px-2 py-0.5 bg-white/5 border border-white/10 rounded-lg w-fit">
                          <span className="text-[8px] uppercase font-black text-zinc-500 tracking-tighter">Base Form:</span>
                          <span className="text-[10px] font-bold text-zinc-300">{selectedWord.base_form}</span>
                          <span className="text-[9px] font-medium text-zinc-500">({selectedWord.base_reading})</span>
                        </div>
                      )}
                    </div>
                    {selectedWord.loading ? (
                      <div className="py-2 text-zinc-500 italic animate-pulse text-[10px] font-medium border-t border-white/5 mt-1">Lexicon search...</div>
                    ) : (
                      <>
                        <div className="space-y-3 pt-3 border-t border-white/10 overflow-y-auto max-h-[40vh] scrollbar-hide">
                          {/* UNIVERSAL MEANING DISPLAY */}
                          <div className="space-y-1">
                            <p className="text-[8px] uppercase font-black text-zinc-600 tracking-widest">Meaning</p>
                            <div className="text-zinc-100 text-[11px] md:text-[13px] font-bold leading-relaxed">
                               {selectedWord.is_rich ? (
                                 <>{selectedWord.meaning_hi ? `${selectedWord.meaning_en} / ${selectedWord.meaning_hi}` : selectedWord.meaning_en}</>
                               ) : (
                                 Array.isArray(selectedWord.meaning) ? selectedWord.meaning.slice(0, 3).join("; ") : selectedWord.meaning
                               )}
                            </div>
                          </div>

                          {/* RICH ONLY: Examples */}
                          {selectedWord.is_rich && selectedWord.examples && selectedWord.examples.length > 0 && (
                            <div className="space-y-2">
                               <p className="text-[8px] uppercase font-black text-zinc-600 tracking-widest border-t border-white/5 pt-1.5">Examples</p>
                               <div className="space-y-2">
                                 {selectedWord.examples.map((ex: DictExample, i: number) => (
                                   <div key={i} className="text-[10px] md:text-xs text-zinc-400 leading-snug">
                                     <p className="text-white font-medium">{ex.jp}</p>
                                     <p className="opacity-60">{ex.hi}</p>
                                   </div>
                                 ))}
                               </div>
                            </div>
                          )}

                          {/* SIMPLE ONLY: Prompt to upgrade to Rich */}
                          {!selectedWord.is_rich && (
                            <p className="text-[8px] text-zinc-500 italic mt-2 opacity-50">Deep AI insights generated upon saving to Mem.</p>
                          )}
                        </div>

                        {/* Save to Mem Button */}
                        <div className="pt-3 border-t border-white/10 flex flex-col gap-2">
                          <button 
                            onClick={(e) => {
                              const url = selectedWord.notion_url || getNotionUrl(selectedWord.word);
                              if (url) {
                                window.open(url, '_blank');
                              } else {
                                handleSaveWord();
                              }
                            }}
                            disabled={isSaving || (isSaved(selectedWord.word) && !selectedWord.notion_url && !getNotionUrl(selectedWord.word)) || saveStatus === 'success' && !selectedWord.notion_url && !getNotionUrl(selectedWord.word)}
                            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-tighter transition-all active:scale-95 ${
                              (isSaved(selectedWord.word) || saveStatus === 'success')
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 cursor-pointer'
                              : 'bg-white text-black hover:bg-zinc-200'
                            }`}
                          >
                            {isSaving ? (
                              <><Search className="animate-pulse" size={14} /> Generating Rich Note...</>
                            ) : (isSaved(selectedWord.word) || saveStatus === 'success') ? (
                              <><Check size={14} /> {(selectedWord.notion_url || getNotionUrl(selectedWord.word)) ? "View in Notion ↗" : "Saved to Notion"}</>
                            ) : (
                              <><Save size={14} /> Save to Notion (Add AI Context) -&gt;</>
                            )}
                          </button>

                          {isSaved(selectedWord.word) && (
                             <button 
                               onClick={handleSyncNotion}
                               disabled={isSyncing}
                               className="flex items-center justify-center gap-1.5 py-1 text-[9px] font-black uppercase text-zinc-500 hover:text-orange-500 transition-all active:scale-95"
                             >
                               <RefreshCw size={10} className={isSyncing ? "animate-spin" : ""} />
                               {isSyncing ? "Syncing..." : "Sync with Notion"}
                             </button>
                           )}

                          {saveStatus === 'error' && (
                            <div className="flex items-center gap-1.5 text-red-400 text-[9px] font-bold justify-center">
                              <AlertCircle size={10} /> Connection Error
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Visual Arrow Pointing to the Word */}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[10px] border-t-[#09090b]/98" />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* --- INTERACTIVE TRANSCRIPT --- */}
      <div className="mt-12 md:mt-16 w-full max-w-5xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between px-4">
          <h2 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-3">
             <div className="w-2 h-8 bg-orange-600 rounded-full" />
             Interactive Transcript
          </h2>
          <span className="text-[10px] uppercase font-black text-zinc-600 tracking-widest">{localSegments.length} Sentences</span>
        </div>

        <div 
          ref={transcriptRef}
          key={`transcript-${savedWords.size}`} // Force re-render on sync change
          onMouseEnter={() => setIsManualScrolling(true)}
          onMouseLeave={() => setIsManualScrolling(false)}
          className="bg-black/20 border border-white/5 rounded-[2rem] max-h-[75vh] overflow-y-auto backdrop-blur-3xl relative
                     scrollbar-thin scrollbar-thumb-orange-600/30 scrollbar-track-transparent hover:scrollbar-thumb-orange-600/50 transition-all"
        >
          {localSegments.map((seg, idx) => {
            const isActive = activeSeg?.id === seg.id;
            const isLoopingThis = loopSegmentId === seg.id;

            return (
              <div 
                key={seg.id}
                id={`seg-${seg.id}`}
                onClick={() => toggleLineLoop(idx)}
                className={`group relative flex gap-6 p-6 md:p-8 cursor-pointer transition-all border-b border-white/5 last:border-0 ${
                  isActive ? 'bg-white/[0.03]' : 'hover:bg-white/[0.01]'
                } ${isLoopingThis ? 'ring-2 ring-inset ring-orange-600/50' : ''} ${
                  syncSuccessIdx !== null && idx >= syncSuccessIdx ? 'border-l-2 border-l-green-500/30' : ''
                }`}
              >
                  <div className="flex flex-col items-center gap-2 min-w-[32px]">
                    <span className={`text-xs font-black tabular-nums transition-colors ${isActive ? 'text-orange-500' : 'text-zinc-700'}`}>
                      {(idx + 1).toString().padStart(2, '0')}
                    </span>
                    <div className="h-4 flex items-center justify-center">
                      {isLoopingThis && <Repeat size={14} className="text-orange-500 animate-pulse" />}
                      {!isLoopingThis && isActive && <Repeat size={14} className="text-zinc-700 opacity-50" />}
                    </div>
                  </div>

                <div className="flex flex-col gap-3 flex-1">
                  {/* Japanese Text with Furigana */}
                  <div className="flex flex-wrap gap-x-1 md:gap-x-2 items-end pointer-events-none">
                    {seg.furigana.map((t, ti) => (
                      <ruby key={ti} className={`font-black leading-none ${isActive ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                        {t.segments ? (
                          t.segments.map((s, si) => (
                            <React.Fragment key={si}>
                              <span className="text-lg md:text-2xl">{s.text}</span>
                              {s.f && (
                                <rt className="text-[10px] md:text-xs font-bold text-orange-500/80 mb-0.5 tracking-tight">
                                  {s.f}
                                </rt>
                              )}
                            </React.Fragment>
                          ))
                        ) : (
                          <>
                            {t.furigana && (
                              <rt className="text-[10px] md:text-xs font-bold text-orange-500/80 mb-0.5 tracking-tight">
                                {t.furigana}
                              </rt>
                            )}
                            <span className="text-lg md:text-2xl">{t.surface}</span>
                          </>
                        )}
                      </ruby>
                    ))}
                  </div>

                  {/* Translation */}
                  {seg.translation && (
                    <p className={`text-xs md:text-base font-bold tracking-tight transition-all ${
                      isActive ? 'text-zinc-200' : 'text-zinc-600 group-hover:text-zinc-400'
                    }`}>
                      {seg.translation}
                    </p>
                  )}
                </div>

                {/* Timestamp & Sync Button */}
                <div className="flex flex-col items-end gap-2 self-center min-w-[60px]">
                  <div className={`text-[10px] md:text-xs font-black tabular-nums transition-colors ${
                    syncSuccessIdx !== null && idx >= syncSuccessIdx ? 'text-green-400' : 'text-zinc-800'
                  }`}>
                    {formatTime(seg.start)}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); shiftTranscript(idx); }}
                    className={`p-1.5 border rounded-md transition-all group/sync ${
                      syncSuccessIdx === idx 
                        ? 'bg-green-500/20 border-green-500/50 text-green-400 scale-110' 
                        : 'bg-white/5 border-white/5 hover:bg-orange-500/20 hover:border-orange-500/30 text-zinc-600 hover:text-orange-500'
                    }`}
                    title="Sync this and all following lines to current time"
                  >
                    {syncSuccessIdx === idx ? <Check size={12} /> : <Clock size={12} className="group-hover/sync:scale-110" />}
                  </button>
                </div>

                {/* Hover UI removed or moved to icons */}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
