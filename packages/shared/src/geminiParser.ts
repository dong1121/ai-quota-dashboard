/**
 * Parse Google Wiz server-rendered HTML from gemini.google.com/app
 * to extract signed-in Google email and recent conversation IDs.
 * Pure function so it can be shared and unit-tested cleanly.
 */
export interface ParsedGeminiAppHtml {
  email: string | null;
  conversationIds: string[];
}

export function parseGeminiAppHtml(html: string): ParsedGeminiAppHtml {
  if (!html) return { email: null, conversationIds: [] };

  // 1. Extract signed-in Google email from WIZ_global_data ("oPEP7c":"user@gmail.com")
  let email: string | null = null;
  const wizEmailMatch = html.match(/"oPEP7c"\s*:\s*"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"/);
  if (wizEmailMatch?.[1]) {
    email = wizEmailMatch[1].toLowerCase();
  }

  // 2. Extract Gemini conversation identifiers (c_<16-hex> or /app/<16-hex>)
  const seen = new Set<string>();
  const convRegex = /(?:"(c_[0-9a-f]{12,24})"|\/app\/([0-9a-f]{12,24}))/gi;
  let match: RegExpExecArray | null;
  while ((match = convRegex.exec(html)) !== null) {
    const rawId = (match[1] ?? match[2] ?? '').replace(/^c_/i, '').toLowerCase();
    if (rawId && !seen.has(rawId)) {
      seen.add(rawId);
      if (seen.size >= 40) break;
    }
  }

  return {
    email,
    conversationIds: Array.from(seen),
  };
}
