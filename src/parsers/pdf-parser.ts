import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import type { DocumentParser } from "../application/ports.js";
import { PermanentIngestionError } from "../domain/errors.js";

export class PdfParser implements DocumentParser {
  async parse(path: string) {
    try {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loadingTask = getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true });
      const document = await loadingTask.promise;
      const blocks = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const text = await page.getTextContent();
        const content = text.items
          .filter((item): item is TextItem => "str" in item)
          .map((item) => item.str)
          .join(" ");
        if (content.trim()) blocks.push({ content, locator: { format: "pdf" as const, page: pageNumber } });
        page.cleanup();
      }
      await loadingTask.destroy();
      return blocks;
    } catch (error) {
      throw new PermanentIngestionError("Malformed or unreadable PDF document", { cause: error });
    }
  }
}
import { readFile } from "node:fs/promises";
