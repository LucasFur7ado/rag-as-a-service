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
 */

export interface Chunk {
  /** 0-based index of the chunk within the whole document. */
  index: number;
  /** 1-based page number when the source has pages (PDF); null otherwise. */
  page: number | null;
  text: string;
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
    for (const chunkText of splitTextRecursive(text, chunkSize, overlap)) {
      chunks.push({ index: chunks.length, page, text: chunkText });
    }
  }
  return chunks;
}

/** Split one text into chunks of at most `chunkSize` chars with overlap. */
export function splitTextRecursive(
  text: string,
  chunkSize = CHUNK_SIZE_CHARS,
  overlap = CHUNK_OVERLAP_CHARS,
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];
  return packPieces(atomize(normalized, chunkSize, 0), chunkSize, overlap);
}

/** Recursively split text into pieces no longer than `maxLen`. */
function atomize(text: string, maxLen: number, separatorIndex: number): string[] {
  if (text.length <= maxLen) return [text];

  const separator = SEPARATORS[separatorIndex];
  if (separator === "") {
    // Last resort: hard split (e.g. one enormous unbroken token).
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += maxLen) {
      parts.push(text.slice(i, i + maxLen));
    }
    return parts;
  }

  // Split, keeping the separator attached to the preceding piece so nothing
  // is lost when pieces are re-joined.
  const rawParts = text.split(separator);
  const pieces: string[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const part = i < rawParts.length - 1 ? rawParts[i] + separator : rawParts[i];
    if (!part) continue;
    if (part.length <= maxLen) {
      pieces.push(part);
    } else {
      pieces.push(...atomize(part, maxLen, separatorIndex + 1));
    }
  }
  return pieces;
}

/** Greedily pack atomic pieces into chunks, with piece-aligned overlap. */
function packPieces(pieces: string[], chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  const flush = () => {
    const chunk = current.join("").trim();
    if (chunk) chunks.push(chunk);
    // Carry whole trailing pieces (up to `overlap` chars) into the next chunk.
    const carried: string[] = [];
    let carriedLen = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      if (carriedLen + current[i].length > overlap) break;
      carried.unshift(current[i]);
      carriedLen += current[i].length;
    }
    // If no whole piece fits (pieces larger than the overlap budget), fall
    // back to a character tail snapped to the nearest word boundary so some
    // overlap is always carried.
    if (carried.length === 0 && overlap > 0 && chunk.length > overlap) {
      const tail = chunk.slice(-overlap);
      const firstSpace = tail.indexOf(" ");
      const snapped = (firstSpace >= 0 ? tail.slice(firstSpace + 1) : tail) + " ";
      carried.push(snapped);
      carriedLen = snapped.length;
    }
    current = carried;
    currentLen = carriedLen;
  };

  for (const piece of pieces) {
    if (currentLen + piece.length > chunkSize && current.length > 0) {
      flush();
      // The carried overlap plus a near-chunk-size piece can still overflow;
      // shed carried pieces from the front until the new piece fits.
      while (current.length > 0 && currentLen + piece.length > chunkSize) {
        currentLen -= current[0].length;
        current.shift();
      }
    }
    current.push(piece);
    currentLen += piece.length;
  }
  const last = current.join("").trim();
  // Only emit the tail if it adds content beyond the carried overlap.
  if (last && (chunks.length === 0 || !chunks[chunks.length - 1].endsWith(last))) {
    chunks.push(last);
  }
  return chunks;
}
