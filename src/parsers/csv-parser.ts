import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import type { DocumentParser } from "../application/ports";
import { PermanentIngestionError } from "../domain/errors";

export class CsvParser implements DocumentParser {
  async parse(path: string) {
    try {
      const records = parse(await readFile(path, "utf8"), {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: false,
        trim: true,
      }) as Array<Record<string, string>>;
      return records.map((record, index) => ({
        content: Object.entries(record)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n"),
        locator: { format: "csv" as const, row_start: index + 2, row_end: index + 2 },
      }));
    } catch (error) {
      throw new PermanentIngestionError("Malformed CSV document", { cause: error });
    }
  }
}
