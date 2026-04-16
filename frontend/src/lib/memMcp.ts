const MEM_MCP_URL = "https://mcp.mem.ai/mcp";

export interface DictData {
  word: string;
  reading: string;
  romaji: string;
  jlpt: string;
  part_of_speech: string;
  meaning_en: string;
  meaning_hi: string;
  examples: { jp: string; hi: string }[];
}

function buildMemNote(data: DictData, sourceAnime = "JapanEase AI") {
  return `# ${data.word} (${data.reading})

**Reading:** ${data.reading} · ${data.romaji}
**JLPT:** ${data.jlpt} · ${data.part_of_speech}

## Meaning
- EN: ${data.meaning_en}
- HI: ${data.meaning_hi}

## Examples
${data.examples.map((e, i) =>
  `**${i + 1}.** ${e.jp}\n   → ${e.hi}`
).join("\n\n")}

---
Source: ${sourceAnime}
Tags: #japanese #vocabulary #${data.jlpt?.toLowerCase() || 'unknown'} #anime`;
}

export async function saveToMem(dictData: DictData, sourceAnime: string, memToken?: string) {
  const note = buildMemNote(dictData, sourceAnime);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (memToken) headers["Authorization"] = `Bearer ${memToken}`;

  const res = await fetch(MEM_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "create_note",
        arguments: { content: note }
      }
    })
  });

  if (!res.ok) throw new Error(`Mem MCP HTTP error: ${res.status}`);

  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "Mem MCP tool error");

  return json.result;
}
