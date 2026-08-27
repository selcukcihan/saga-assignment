import type { DocumentParser, ParserRegistry } from "../application/ports";
import type { SupportedMediaType } from "../domain/documents";
import { CsvParser } from "./csv-parser";
import { DocxParser } from "./docx-parser";
import { JsonParser } from "./json-parser";
import { PdfParser } from "./pdf-parser";
import { PdfJsTextExtractor } from "./pdfjs-text-extractor";
import { TesseractPdfOcr } from "./tesseract-pdf-ocr";

export interface PdfExtractionConfig {
  ocrEnabled: boolean;
  ocrMinNativeCharacters: number;
  ocrDpi: number;
  ocrLanguage: string;
  ocrTimeoutMs: number;
}

export class DefaultParserRegistry implements ParserRegistry {
  private readonly parsers: Record<SupportedMediaType, DocumentParser>;

  constructor(pdfConfig: PdfExtractionConfig) {
    this.parsers = {
      "application/pdf": new PdfParser(
        new PdfJsTextExtractor(),
        new TesseractPdfOcr({
          dpi: pdfConfig.ocrDpi,
          language: pdfConfig.ocrLanguage,
          timeoutMs: pdfConfig.ocrTimeoutMs,
        }),
        pdfConfig,
      ),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": new DocxParser(),
      "text/csv": new CsvParser(),
      "application/json": new JsonParser(),
    };
  }

  get(mediaType: SupportedMediaType): DocumentParser {
    return this.parsers[mediaType];
  }
}
