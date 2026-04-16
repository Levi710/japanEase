import axios from 'axios';

const BACKEND_URL = "http://localhost:8000";

export interface DictData {
  word: string;
  reading: string;
  romaji: string;
  meaning_en: string;
  meaning_hi: string;
  is_rich: boolean;
  examples: Array<{
    jp: string;
    hi: string;
  }>;
  jlpt?: string;
  tags?: string[];
  grammar_points?: string[];
}

/**
 * Save vocabulary data to Notion via the FastAPI backend.
 * @param data The rich dictionary data to save
 * @param source The source label (e.g. "JapanEase AI Demo")
 */
export const saveToNotion = async (data: DictData, source: string = "JapanEase AI") => {
  try {
    const response = await axios.post(`${BACKEND_URL}/notion/save`, {
      data,
      source
    });
    return response.data;
  } catch (error) {
    console.error("Error saving to Notion:", error);
    throw error;
  }
};