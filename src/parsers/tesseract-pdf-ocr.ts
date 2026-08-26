import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PdfPageOcr } from "./pdf-parser.js";

const executeFile = promisify(execFile);

export interface TesseractPdfOcrOptions {
  dpi: number;
  language: string;
  timeoutMs: number;
}

export class TesseractPdfOcr implements PdfPageOcr {
  constructor(private readonly options: TesseractPdfOcrOptions) {}

  async extract(pdfPath: string, pageNumber: number): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "saga-pdf-ocr-"));
    const imagePrefix = path.join(directory, `page-${pageNumber}`);
    const imagePath = `${imagePrefix}.png`;
    try {
      await executeFile(
        "pdftoppm",
        [
          "-f",
          String(pageNumber),
          "-l",
          String(pageNumber),
          "-singlefile",
          "-r",
          String(this.options.dpi),
          "-png",
          pdfPath,
          imagePrefix,
        ],
        { timeout: this.options.timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      );
      const result = await executeFile(
        "tesseract",
        [imagePath, "stdout", "--dpi", String(this.options.dpi), "-l", this.options.language],
        { timeout: this.options.timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      );
      return result.stdout;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
