import { describe, expect, it, vi } from "vitest";
import {
  PdfParser,
  type NativePdfTextExtractor,
  type PdfPageOcr,
} from "../../src/parsers/pdf-parser.js";

function setup(pages: Awaited<ReturnType<NativePdfTextExtractor["extract"]>>) {
  const nativeText = { extract: vi.fn().mockResolvedValue(pages) } satisfies NativePdfTextExtractor;
  const ocr = { extract: vi.fn().mockResolvedValue("") } satisfies PdfPageOcr;
  const parser = new PdfParser(nativeText, ocr, { ocrEnabled: true, ocrMinNativeCharacters: 100 });
  return { nativeText, ocr, parser };
}

describe("PdfParser", () => {
  it("keeps a healthy native text layer without paying the OCR cost", async () => {
    const content = `Native text ${"contains useful legal content ".repeat(6)}`;
    const { parser, ocr } = setup([{ pageNumber: 1, content, hasRasterImage: true }]);

    await expect(parser.parse("contract.pdf")).resolves.toEqual([
      { content: content.trim(), locator: { format: "pdf", page: 1 } },
    ]);
    expect(ocr.extract).not.toHaveBeenCalled();
  });

  it("uses OCR for an image-backed page with a suspiciously small text layer", async () => {
    const { parser, ocr } = setup([
      { pageNumber: 1, content: "POST /chat", hasRasterImage: true },
    ]);
    ocr.extract.mockResolvedValue(
      "Core Requirements\n\nIngest documents: PDF, DOCX, CSV, JSON\nStore chunks with embeddings",
    );

    const blocks = await parser.parse("assignment.pdf");
    expect(ocr.extract).toHaveBeenCalledWith("assignment.pdf", 1);
    expect(blocks).toEqual([
      {
        content: "Core Requirements\n\nIngest documents: PDF, DOCX, CSV, JSON\nStore chunks with embeddings",
        locator: { format: "pdf", page: 1 },
      },
    ]);
  });

  it("does not OCR a short text-only page", async () => {
    const { parser, ocr } = setup([
      { pageNumber: 2, content: "Short but valid notice", hasRasterImage: false },
    ]);

    await expect(parser.parse("notice.pdf")).resolves.toEqual([
      { content: "Short but valid notice", locator: { format: "pdf", page: 2 } },
    ]);
    expect(ocr.extract).not.toHaveBeenCalled();
  });

  it("retains native text when OCR recovers less content", async () => {
    const { parser, ocr } = setup([
      { pageNumber: 3, content: "A short native text layer with an important identifier", hasRasterImage: true },
    ]);
    ocr.extract.mockResolvedValue("identifier");

    await expect(parser.parse("mixed.pdf")).resolves.toEqual([
      {
        content: "A short native text layer with an important identifier",
        locator: { format: "pdf", page: 3 },
      },
    ]);
  });

  it("translates OCR failures into a permanent ingestion error", async () => {
    const { parser, ocr } = setup([{ pageNumber: 1, content: "", hasRasterImage: true }]);
    ocr.extract.mockRejectedValue(new Error("tesseract failed"));

    await expect(parser.parse("broken.pdf")).rejects.toMatchObject({
      retryable: false,
      message: "Malformed, unreadable, or unextractable PDF document",
    });
  });
});
