import type { DocumentParser, ParserRegistry } from "../application/ports.js";
import type { SupportedMediaType } from "../domain/documents.js";
import { CsvParser } from "./csv-parser.js";
import { DocxParser } from "./docx-parser.js";
import { JsonParser } from "./json-parser.js";
import { PdfParser } from "./pdf-parser.js";
import { PdfJsTextExtractor } from "./pdfjs-text-extractor.js";
import { TesseractPdfOcr } from "./tesseract-pdf-ocr.js";

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
