/**
 * Deterministic quote verification (SOURCE_OF_TRUTH §9 Step 3).
 * A claimed quote enters case state only if it can be found in the claimed
 * source document by exact string search, after a small, purely mechanical
 * normalization (whitespace runs and typographic quotes/dashes). No model is
 * involved in accepting or rejecting a quote.
 */

function normalize(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type VerifyResult =
  | { verified: true; matchedText: string }
  | { verified: false };

/**
 * Returns the exact substring of `source` that matches `quote` (so the UI can
 * highlight the true source text), or verified:false when no match exists.
 */
export function verifyQuote(quote: string, source: string): VerifyResult {
  if (!quote.trim()) return { verified: false };

  // Fast path: literal containment.
  const literalIdx = source.indexOf(quote);
  if (literalIdx >= 0) return { verified: true, matchedText: quote };

  // Normalized search: walk the source with a normalized sliding comparison.
  const nQuote = normalize(quote);
  if (!nQuote) return { verified: false };
  const nSource = normalize(source);
  if (!nSource.includes(nQuote)) return { verified: false };

  // Recover the original span for highlighting: build an index map from the
  // normalized source back to the original source.
  const map: number[] = [];
  let out = "";
  let prevWasSpace = true; // leading whitespace is trimmed
  for (let i = 0; i < source.length; i++) {
    let ch = source[i]
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-");
    if (/\s/.test(ch)) {
      if (prevWasSpace) continue;
      out += " ";
      map.push(i);
      prevWasSpace = true;
    } else {
      out += ch.toLowerCase();
      map.push(i);
      prevWasSpace = false;
    }
  }
  // Trim trailing space from the map/out.
  while (out.endsWith(" ")) {
    out = out.slice(0, -1);
    map.pop();
  }
  const idx = out.indexOf(nQuote);
  if (idx < 0) return { verified: false }; // normalization mismatch edge case
  const start = map[idx];
  const end = map[idx + nQuote.length - 1] + 1;
  return { verified: true, matchedText: source.slice(start, end) };
}
