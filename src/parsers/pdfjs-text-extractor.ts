import { readFile } from "node:fs/promises";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import type { NativePdfPage, NativePdfTextExtractor } from "./pdf-parser.js";

export class PdfJsTextExtractor implements NativePdfTextExtractor {
  async extract(path: string): Promise<NativePdfPage[]> {
    const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true });
    try {
      const document = await loadingTask.promise;
      const pages: NativePdfPage[] = [];
      const imageOperators = new Set([
        OPS.paintImageMaskXObject,
        OPS.paintImageMaskXObjectGroup,
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintInlineImageXObjectGroup,
        OPS.paintImageXObjectRepeat,
        OPS.paintImageMaskXObjectRepeat,
      ]);
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const [text, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
        const content = text.items
          .filter((item): item is TextItem => "str" in item)
          .map((item) => `${item.str}${item.hasEOL ? "\n" : " "}`)
          .join("");
        pages.push({
          pageNumber,
          content,
          hasRasterImage: operators.fnArray.some((operator) => imageOperators.has(operator)),
        });
        page.cleanup();
      }
      return pages;
    } finally {
      await loadingTask.destroy();
    }
  }
}
