import { useState, useEffect, useCallback } from "react";

/**
 * Hook to track and persist saved words for the current session.
 * This handles highlighting vocabulary within the subtitle player.
 */
export function useSavedWords() {
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [notionUrls, setNotionUrls] = useState<Record<string, string>>({});

  // LOAD ONCE: On mount, load from localStorage
  useEffect(() => {
    const cached = localStorage.getItem("japanease_saved_words");
    const cachedUrls = localStorage.getItem("japanease_notion_urls");
    if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setSavedWords(new Set<string>(parsed));
        }
    }
    if (cachedUrls) {
      try {
        setNotionUrls(JSON.parse(cachedUrls));
      } catch (e) {}
    }
  }, []);

  const markSaved = (word: string, url?: string) => {
    setSavedWords(prev => {
      const next = new Set([...Array.from(prev), word]);
      localStorage.setItem("japanease_saved_words", JSON.stringify(Array.from(next)));
      return next;
    });
    if (url) {
      setNotionUrls(prev => {
        const next = { ...prev, [word]: url };
        localStorage.setItem("japanease_notion_urls", JSON.stringify(next));
        return next;
      });
    }
  };

  const isSaved = useCallback((word: string) => {
    return savedWords.has(word);
  }, [savedWords]);

  // BROADCAST SYNC: Listen for changes in other tabs or hook instances
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "japanease_saved_words" && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) {
            setSavedWords(new Set<string>(parsed));
          }
        } catch (e) {}
      }
      if (e.key === "japanease_notion_urls" && e.newValue) {
        try {
          setNotionUrls(JSON.parse(e.newValue));
        } catch (e) {}
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const syncFromNotion = async (apiBase: string) => {
    try {
      const response = await fetch(`${apiBase}/notion/sync`);
      const data = await response.json();
      if (data.status === "success" && Array.isArray(data.words)) {
        const words = data.words.map((w: any) => w.word);
        const urls = data.words.reduce((acc: any, w: any) => {
          acc[w.word] = w.url;
          return acc;
        }, {});

        const nextWords = new Set<string>(words);
        setSavedWords(nextWords);
        setNotionUrls(urls);
        
        localStorage.setItem("japanease_saved_words", JSON.stringify(Array.from(nextWords)));
        localStorage.setItem("japanease_notion_urls", JSON.stringify(urls));
        return true;
      }
    } catch (error) {
      console.error("Failed to sync from Notion:", error);
    }
    return false;
  };

  const getNotionUrl = (word: string) => notionUrls[word];

  return { savedWords, markSaved, isSaved, syncFromNotion, getNotionUrl };
}
