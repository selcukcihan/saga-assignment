import type { DocumentParser } from "../application/ports";
import { PermanentIngestionError } from "../domain/errors";

export interface NativePdfPage {
  pageNumber: number;
  content: string;
  hasRasterImage: boolean;
}

export interface NativePdfTextExtractor {
  extract(path: string): Promise<NativePdfPage[]>;
}

export interface PdfPageOcr {
  extract(path: string, pageNumber: number): Promise<string>;
}

export interface PdfParserOptions {
  ocrEnabled: boolean;
  ocrMinNativeCharacters: number;
}

function normalizeText(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function meaningfulCharacterCount(content: string): number {
  return content.replace(/\s/g, "").length;
}

export class PdfParser implements DocumentParser {
  constructor(
    private readonly nativeText: NativePdfTextExtractor,
    private readonly ocr: PdfPageOcr,
    private readonly options: PdfParserOptions,
  ) {}

  async parse(path: string) {
    try {
      const pages = await this.nativeText.extract(path);
      const blocks = [];
      for (const page of pages) {
        const nativeContent = normalizeText(page.content);
        const shouldOcr =
          this.options.ocrEnabled &&
          page.hasRasterImage &&
          meaningfulCharacterCount(nativeContent) < this.options.ocrMinNativeCharacters;
        const ocrContent = shouldOcr ? normalizeText(await this.ocr.extract(path, page.pageNumber)) : "";
        const content = meaningfulCharacterCount(ocrContent) > meaningfulCharacterCount(nativeContent)
          ? ocrContent
          : nativeContent;
        if (content) blocks.push({ content, locator: { format: "pdf" as const, page: page.pageNumber } });
      }
      return blocks;
    } catch (error) {
      throw new PermanentIngestionError("Malformed, unreadable, or unextractable PDF document", { cause: error });
    }
  }
}
