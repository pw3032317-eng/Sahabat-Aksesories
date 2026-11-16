export type TextRange = [number, number];

export interface FuzzyFieldInput {
  text: string;
  weight?: number;
}

export interface FuzzyMatchResult {
  score: number;
  fieldRanges: TextRange[][];
}

/**
 * Merge overlapping or adjacent half-open highlight ranges [start, end).
 */
export function mergeRanges(ranges: TextRange[]): TextRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: TextRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr[0] <= prev[1]) {
      prev[1] = Math.max(prev[1], curr[1]);
    } else {
      merged.push([curr[0], curr[1]]);
    }
  }
  return merged;
}

/**
 * Compute optimal string alignment (Damerau-Levenshtein) distance with early exit.
 */
function editDistance(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  if (a === b) return 0;

  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }

  return dp[n][m];
}

interface WordSpan {
  word: string;
  start: number;
  end: number;
}

function splitWordSpans(lowerText: string): WordSpan[] {
  const spans: WordSpan[] = [];
  const regex = /[a-z0-9]+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(lowerText)) !== null) {
    spans.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return spans;
}

/**
 * Match a single token against a normalized lowercase field string,
 * returning score and character index ranges in the original field string.
 */
function matchTokenInField(
  token: string,
  lowerText: string,
  wordSpans: WordSpan[],
): { score: number; ranges: TextRange[] } | null {
  if (!token || !lowerText) return null;

  // 1. Direct substring match(es) — highest precision
  const directIdx = lowerText.indexOf(token);
  if (directIdx !== -1) {
    const ranges: TextRange[] = [];
    let pos = directIdx;
    while (pos !== -1 && ranges.length < 6) {
      ranges.push([pos, pos + token.length]);
      pos = lowerText.indexOf(token, pos + token.length);
    }
    const isStart = directIdx === 0;
    const isWordBoundary =
      isStart || !/[a-z0-9]/.test(lowerText[directIdx - 1] || '');
    const isExactWord =
      isWordBoundary &&
      (directIdx + token.length === lowerText.length ||
        !/[a-z0-9]/.test(lowerText[directIdx + token.length] || ''));

    const bonus = (isStart ? 35 : 0) + (isWordBoundary ? 25 : 0) + (isExactWord ? 20 : 0);
    return {
      score: 100 + bonus + Math.min(token.length * 4, 24),
      ranges,
    };
  }

  // 2. Word-level fuzzy typo match (1-2 edit operations)
  if (token.length >= 3) {
    const maxDist = token.length >= 6 ? 2 : 1;
    let bestSpan: WordSpan | null = null;
    let bestDist = maxDist + 1;

    for (const span of wordSpans) {
      // Also allow prefix typo comparison when the word is longer than the token
      const candidate =
        span.word.length > token.length + 1
          ? span.word.slice(0, token.length + 1)
          : span.word;
      const dist = editDistance(token, candidate, maxDist);
      if (dist < bestDist) {
        bestDist = dist;
        bestSpan = span;
        if (dist === 0) break;
      }
      // Also compare full word if candidate trimmed didn't beat it
      if (candidate !== span.word) {
        const fullDist = editDistance(token, span.word, maxDist);
        if (fullDist < bestDist) {
          bestDist = fullDist;
          bestSpan = span;
        }
      }
    }

    if (bestSpan && bestDist <= maxDist) {
      // Highlight matching characters within that word cleanly
      const subRanges: TextRange[] = [];
      let ti = 0;
      for (let wi = 0; wi < bestSpan.word.length && ti < token.length; wi++) {
        if (bestSpan.word[wi] === token[ti]) {
          subRanges.push([bestSpan.start + wi, bestSpan.start + wi + 1]);
          ti++;
        }
      }
      // Fallback highlight whole span if characters were transposed cleanly
      const finalRanges: TextRange[] =
        subRanges.length >= Math.max(2, Math.floor(token.length / 2))
          ? mergeRanges(subRanges)
          : [[bestSpan.start, Math.min(bestSpan.end, bestSpan.start + token.length)]];

      return {
        score: (bestDist === 1 ? 68 : 48) + Math.min(token.length * 2, 12),
        ranges: finalRanges,
      };
    }
  }

  // 3. Tight ordered subsequence match (e.g. "lcdip13" -> "LCD+TS IPHONE 13")
  if (token.length >= 3) {
    const positions: number[] = [];
    let qIdx = 0;
    for (let i = 0; i < lowerText.length && qIdx < token.length; i++) {
      if (lowerText[i] === token[qIdx]) {
        positions.push(i);
        qIdx++;
      }
    }

    if (qIdx === token.length && positions.length > 0) {
      const spanLen = positions[positions.length - 1] - positions[0] + 1;
      const avgGap = spanLen / token.length;
      if (avgGap <= 3.2) {
        const ranges = mergeRanges(positions.map((p): TextRange => [p, p + 1]));
        const score = Math.max(20, Math.round(55 - avgGap * 8));
        return { score, ranges };
      }
    }
  }

  return null;
}

/**
 * Fuzzy-match a multi-word query against multiple weighted fields of an item.
 * Returns null if any token fails to match at least one field, or { score, fieldRanges }.
 */
export function fuzzyMatchFields(
  query: string,
  fields: FuzzyFieldInput[],
): FuzzyMatchResult | null {
  const tokens = query
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);

  if (!tokens.length) return null;

  const prepared = fields.map((f) => {
    const raw = f.text || '';
    const lower = raw.toLowerCase();
    return {
      lower,
      weight: f.weight ?? 1,
      wordSpans: splitWordSpans(lower),
    };
  });

  const collectedRanges: TextRange[][] = prepared.map(() => []);
  let totalScore = 0;

  for (const token of tokens) {
    let matchedAtLeastOnce = false;
    let bestTokenScore = 0;

    prepared.forEach((field, fieldIdx) => {
      const hit = matchTokenInField(token, field.lower, field.wordSpans);
      if (hit) {
        matchedAtLeastOnce = true;
        collectedRanges[fieldIdx].push(...hit.ranges);
        const weighted = hit.score * field.weight;
        if (weighted > bestTokenScore) {
          bestTokenScore = weighted;
        }
      }
    });

    if (!matchedAtLeastOnce) {
      return null;
    }
    totalScore += bestTokenScore;
  }

  return {
    score: totalScore,
    fieldRanges: collectedRanges.map((r) => mergeRanges(r)),
  };
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

export function splitHighlightedSegments(
  text: string,
  ranges?: TextRange[],
): HighlightSegment[] {
  if (!text || !ranges || ranges.length === 0) {
    return [{ text, match: false }];
  }
  const merged = mergeRanges(ranges);
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    const safeStart = Math.max(cursor, Math.min(start, text.length));
    const safeEnd = Math.max(safeStart, Math.min(end, text.length));
    if (safeStart > cursor) {
      segments.push({ text: text.slice(cursor, safeStart), match: false });
    }
    if (safeEnd > safeStart) {
      segments.push({ text: text.slice(safeStart, safeEnd), match: true });
    }
    cursor = safeEnd;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }
  return segments;
}
