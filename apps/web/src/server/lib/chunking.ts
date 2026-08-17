import { CHUNK_OVERLAP_CHARS, CHUNK_SIZE_CHARS } from "../config";
import type { PageText } from "./extract";

/**
 * Recursive character chunking with overlap.
 *
 * Text is split on the coarsest separator that helps (paragraphs → lines →
 * sentences → words), producing atomic pieces no larger than the chunk size;
 * pieces are then greedily packed into chunks, carrying whole trailing pieces
 * forward as overlap so boundaries stay on paragraph/sentence edges where
 * possible. Sizes live in src/config.ts (CHUNK_SIZE_CHARS, CHUNK_OVERLAP_CHARS).
 *
 * **Every chunk is a contiguous slice of its source page text.** Chunks carry
 * the `[startChar, endChar)` offsets of that slice, which is what makes the
 * retrieval evaluation harness (apps/web/eval) able to compare *different*
 * chunking configurations against one golden dataset: ground truth is anchored
 * to source spans, and chunk ids/boundaries change between configs while source
 * offsets do not. The invariant that makes those offsets meaningful —
 * `sourceText.slice(startChar, endChar) === chunk.text`, up to the CR of a CRLF
 * pair, which normalization drops from the text but not from the offsets — is
 * asserted in chunking.test.ts and must not be broken.
 *
 * Offsets are relative to the *page* text handed to {@link chunkPages} (per page
 * for PDFs, whole-document for txt/markdown, which extract as a single unpaged
 * entry), so a span is only fully identified by `(page, startChar, endChar)`.
 */

export interface Chunk {
  /** 0-based index of the chunk within the whole document. */
  index: number;
  /** 1-based page number when the source has pages (PDF); null otherwise. */
  page: number | null;
  text: string;
  /** Inclusive start offset of this chunk in its source page text. */
  startChar: number;
  /** Exclusive end offset of this chunk in its source page text. */
  endChar: number;
}

/** A chunk of one text, before it is given a document-wide index and page. */
export interface TextChunk {
  text: string;
  startChar: number;
  endChar: number;
}

/** Separators tried in order, coarsest first; "" means a hard character split. */
const SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

/**
 * Chunk extracted pages into overlapping chunks. Pages are chunked
 * independently (a page is already a semantic boundary) so every chunk maps to
 * exactly one page; chunk indexes are contiguous across the whole document.
 */
export function chunkPages(
  pages: PageText[],
  chunkSize = CHUNK_SIZE_CHARS,
  overlap = CHUNK_OVERLAP_CHARS,
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const { page, text } of pages) {
    for (const chunk of splitTextRecursive(text, chunkSize, overlap)) {
      chunks.push({ index: chunks.length, page, ...chunk });
    }
  }
  return chunks;
}

/**
 * Split one text into chunks of at most `chunkSize` chars with overlap.
 *
 * The returned offsets index into `text` exactly as passed in — the internal
 * CRLF/trim normalization is undone via an offset map before returning, so
 * callers never have to know it happened.
 */
export function splitTextRecursive(
  text: string,
  chunkSize = CHUNK_SIZE_CHARS,
  overlap = CHUNK_OVERLAP_CHARS,
): TextChunk[] {
  const { text: normalized, map } = normalizeWithMap(text);
  if (!normalized) return [];

  const spans: Span[] =
    normalized.length <= chunkSize
      ? [{ start: 0, end: normalized.length }]
      : packPieces(
          normalized,
          atomize(normalized, 0, normalized.length, chunkSize, 0),
          chunkSize,
          overlap,
        );

  return spans.map((span) => ({
    text: normalized.slice(span.start, span.end),
    // `map[i]` is where normalized char `i` came from, so the exclusive end is
    // one past the source position of the last included character.
    startChar: map[span.start],
    endChar: map[span.end - 1] + 1,
  }));
}

// --- Normalization ----------------------------------------------------------

interface NormalizedText {
  text: string;
  /** `map[i]` = index in the original text of normalized character `i`. */
  map: number[];
}

/**
 * Apply the chunker's normalization (CRLF → LF, then trim) while recording
 * where every surviving character came from.
 *
 * Without the map, offsets would silently drift from the caller's text by one
 * position per CRLF plus the length of any leading whitespace — small enough to
 * look right in a spot check and wrong enough to invalidate every span-overlap
 * judgement in the eval harness.
 */
function normalizeWithMap(source: string): NormalizedText {
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < source.length; i++) {
    // Drop the CR of a CRLF pair; the LF that follows carries the position.
    if (source[i] === "\r" && source[i + 1] === "\n") continue;
    chars.push(source[i]);
    map.push(i);
  }

  let start = 0;
  let end = chars.length;
  while (start < end && isWhitespace(chars[start])) start++;
  while (end > start && isWhitespace(chars[end - 1])) end--;

  return { text: chars.slice(start, end).join(""), map: map.slice(start, end) };
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

// --- Splitting --------------------------------------------------------------

/** A half-open `[start, end)` region of the normalized text. */
interface Span {
  start: number;
  end: number;
}

/**
 * Recursively split `text[start, end)` into pieces no longer than `maxLen`.
 *
 * Pieces exactly partition the region in order — no character is dropped or
 * duplicated — which is what lets a run of consecutive pieces be described as a
 * single contiguous span later.
 */
function atomize(
  text: string,
  start: number,
  end: number,
  maxLen: number,
  separatorIndex: number,
): Span[] {
  if (end - start <= maxLen) return [{ start, end }];

  const separator = SEPARATORS[separatorIndex];
  if (separator === "") {
    // Last resort: hard split (e.g. one enormous unbroken token).
    const pieces: Span[] = [];
    for (let i = start; i < end; i += maxLen) {
      pieces.push({ start: i, end: Math.min(i + maxLen, end) });
    }
    return pieces;
  }

  // Split, keeping the separator attached to the preceding piece so nothing
  // is lost when pieces are re-joined.
  const pieces: Span[] = [];
  let cursor = start;
  while (cursor < end) {
    const found = text.indexOf(separator, cursor);
    const pieceEnd =
      found === -1 || found >= end ? end : Math.min(found + separator.length, end);
    if (pieceEnd - cursor <= maxLen) {
      pieces.push({ start: cursor, end: pieceEnd });
    } else {
      pieces.push(...atomize(text, cursor, pieceEnd, maxLen, separatorIndex + 1));
    }
    cursor = pieceEnd;
  }
  return pieces;
}

/** Greedily pack atomic pieces into chunks, with piece-aligned overlap. */
function packPieces(
  text: string,
  pieces: Span[],
  chunkSize: number,
  overlap: number,
): Span[] {
  const chunks: Span[] = [];
  let current: Span[] = [];
  let currentLen = 0;

  const lengthOf = (piece: Span) => piece.end - piece.start;

  const flush = () => {
    const chunk = trimSpan(text, {
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    if (chunk) chunks.push(chunk);

    // Carry whole trailing pieces (up to `overlap` chars) into the next chunk.
    const carried: Span[] = [];
    let carriedLen = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      if (carriedLen + lengthOf(current[i]) > overlap) break;
      carried.unshift(current[i]);
      carriedLen += lengthOf(current[i]);
    }
    // If no whole piece fits (the trailing piece is larger than the overlap
    // budget), carry a character tail of it instead, snapped forward to the
    // next word boundary. Taken from the source rather than from the trimmed
    // chunk text so the carried region stays contiguous with what follows.
    if (carried.length === 0 && overlap > 0 && current.length > 0) {
      const last = current[current.length - 1];
      if (lengthOf(last) > overlap) {
        let carryStart = last.end - overlap;
        const spaceAt = text.indexOf(" ", carryStart);
        if (spaceAt !== -1 && spaceAt + 1 < last.end) carryStart = spaceAt + 1;
        carried.push({ start: carryStart, end: last.end });
        carriedLen = last.end - carryStart;
      }
    }
    current = carried;
    currentLen = carriedLen;
  };

  for (const piece of pieces) {
    if (currentLen + lengthOf(piece) > chunkSize && current.length > 0) {
      flush();
      // The carried overlap plus a near-chunk-size piece can still overflow;
      // shed carried pieces from the front until the new piece fits. Shedding
      // from the front keeps the remainder a contiguous suffix.
      while (current.length > 0 && currentLen + lengthOf(piece) > chunkSize) {
        currentLen -= lengthOf(current[0]);
        current.shift();
      }
    }
    current.push(piece);
    currentLen += lengthOf(piece);
  }

  if (current.length > 0) {
    const tail = trimSpan(text, {
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    // Only emit the tail if it adds content beyond the carried overlap.
    const previous = chunks[chunks.length - 1];
    if (tail && (!previous || tail.end > previous.end)) chunks.push(tail);
  }
  return chunks;
}

/** Shrink a span past leading/trailing whitespace; null when nothing is left. */
function trimSpan(text: string, span: Span): Span | null {
  let { start, end } = span;
  while (start < end && isWhitespace(text[start])) start++;
  while (end > start && isWhitespace(text[end - 1])) end--;
  return end > start ? { start, end } : null;
}
