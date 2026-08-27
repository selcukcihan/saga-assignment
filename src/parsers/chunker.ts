import { createHash } from "node:crypto";
import type { Chunker } from "../application/ports";
import type { DocumentChunk, SourceBlock, SourceLocator } from "../domain/documents";

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalized(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function mergeLocators(blocks: readonly SourceBlock[]): SourceLocator {
  const first = blocks[0]!.locator;
  const last = blocks.at(-1)!.locator;
  return {
    ...first,
    ...(last.paragraph_end || last.paragraph_start
      ? { paragraph_end: last.paragraph_end ?? last.paragraph_start }
      : {}),
    ...(last.row_end || last.row_start ? { row_end: last.row_end ?? last.row_start } : {}),
  };
}

function splitText(content: string, target: number, overlap: number): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + target, content.length);
    if (end < content.length) {
      const window = content.slice(start, end);
      const candidates = [window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf(" ")];
      const boundary = Math.max(...candidates);
      if (boundary > target * 0.55) end = start + boundary + 1;
    }
    const part = content.slice(start, end).trim();
    if (part) parts.push(part);
    if (end >= content.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return parts;
}

export class FormatAwareChunker implements Chunker {
  private readonly targetCharacters: number;
  private readonly overlapCharacters: number;

  constructor(targetTokens = 800, overlapTokens = 100) {
    this.targetCharacters = targetTokens * 4;
    this.overlapCharacters = overlapTokens * 4;
  }

  chunk(documentVersionId: string, sourceBlocks: readonly SourceBlock[]): DocumentChunk[] {
    const blocks = sourceBlocks
      .map((block) => ({ ...block, content: normalized(block.content) }))
      .filter((block) => block.content.length > 0);
    const candidates: Array<{ content: string; locator: SourceLocator }> = [];
    let group: SourceBlock[] = [];

    const flush = () => {
      if (!group.length) return;
      const content = group.map((block) => block.content).join("\n\n");
      const locator = mergeLocators(group);
      splitText(content, this.targetCharacters, this.overlapCharacters).forEach((part, index) => {
        candidates.push({ content: part, locator: index ? { ...locator, part: index + 1 } : locator });
      });
      group = [];
    };

    for (const block of blocks) {
      const independentlyCited = block.locator.format === "pdf" || block.locator.format === "json";
      const groupLength = group.reduce((total, item) => total + item.content.length + 2, 0);
      if (independentlyCited || (group.length && groupLength + block.content.length > this.targetCharacters)) flush();
      group.push(block);
      if (independentlyCited || block.content.length >= this.targetCharacters) flush();
    }
    flush();

    return candidates.map((candidate, ordinal) => {
      const contentHash = createHash("sha256").update(candidate.content).digest("hex");
      return {
        id: deterministicUuid(`${documentVersionId}:${ordinal}:${contentHash}`),
        ordinal,
        content: candidate.content,
        contentHash,
        locator: candidate.locator,
      };
    });
  }
}
