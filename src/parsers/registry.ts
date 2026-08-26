import type { DocumentParser, ParserRegistry } from "../application/ports.js";
import type { SupportedMediaType } from "../domain/documents.js";
import { CsvParser } from "./csv-parser.js";
import { DocxParser } from "./docx-parser.js";
import { JsonParser } from "./json-parser.js";
import { PdfParser } from "./pdf-parser.js";

export class DefaultParserRegistry implements ParserRegistry {
  private readonly parsers: Record<SupportedMediaType, DocumentParser> = {
    "application/pdf": new PdfParser(),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": new DocxParser(),
    "text/csv": new CsvParser(),
    "application/json": new JsonParser(),
  };

  get(mediaType: SupportedMediaType): DocumentParser {
    return this.parsers[mediaType];
  }
}
