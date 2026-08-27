import mammoth from "mammoth";
import type { DocumentParser } from "../application/ports";
import { PermanentIngestionError } from "../domain/errors";

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
      if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return named[entity.toLowerCase()] ?? `&${entity};`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export class DocxParser implements DocumentParser {
  async parse(path: string) {
    try {
      const result = await mammoth.convertToHtml({ path });
      const blocks = [];
      const pattern = /<(h[1-6]|p|li)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
      let paragraph = 0;
      let heading: string | undefined;
      for (const match of result.value.matchAll(pattern)) {
        const tag = match[1]!.toLowerCase();
        const content = decodeHtml(match[2] ?? "");
        if (!content) continue;
        if (tag.startsWith("h")) heading = content;
        paragraph += 1;
        blocks.push({
          content,
          locator: {
            format: "docx" as const,
            paragraph_start: paragraph,
            paragraph_end: paragraph,
            ...(heading ? { heading } : {}),
          },
        });
      }
      return blocks;
    } catch (error) {
      throw new PermanentIngestionError("Malformed or unreadable DOCX document", { cause: error });
    }
  }
}
