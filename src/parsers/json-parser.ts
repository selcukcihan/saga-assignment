import { readFile } from "node:fs/promises";
import type { DocumentParser } from "../application/ports";
import type { SourceBlock } from "../domain/documents";
import { PermanentIngestionError } from "../domain/errors";

function childPath(path: string, key: string | number): string {
  return typeof key === "number" ? `${path}[${key}]` : `${path}.${key}`;
}

export class JsonParser implements DocumentParser {
  async parse(path: string): Promise<SourceBlock[]> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new PermanentIngestionError("Malformed JSON document", { cause: error });
    }

    const blocks: SourceBlock[] = [];
    const visit = (current: unknown, jsonPath: string) => {
      if (Array.isArray(current)) {
        current.forEach((item, index) => visit(item, childPath(jsonPath, index)));
        return;
      }
      if (current && typeof current === "object") {
        const entries = Object.entries(current);
        const scalarEntries = Object.fromEntries(
          entries.filter(([, entry]) => entry === null || typeof entry !== "object"),
        );
        if (Object.keys(scalarEntries).length) {
          blocks.push({ content: JSON.stringify(scalarEntries), locator: { format: "json", json_path: jsonPath } });
        }
        entries
          .filter(([, entry]) => entry !== null && typeof entry === "object")
          .forEach(([key, entry]) => visit(entry, childPath(jsonPath, key)));
        return;
      }
      blocks.push({ content: JSON.stringify(current), locator: { format: "json", json_path: jsonPath } });
    };
    visit(value, "$");
    return blocks;
  }
}
