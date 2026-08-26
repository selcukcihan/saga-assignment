import { describe, expect, it } from "vitest";
import { FormatAwareChunker } from "../../src/parsers/chunker.js";

describe("FormatAwareChunker", () => {
  it("uses deterministic identities and retains PDF page locations", () => {
    const chunker = new FormatAwareChunker(10, 2);
    const blocks = [{ content: "A sentence that is long enough to split. Another sentence follows.", locator: { format: "pdf" as const, page: 4 } }];

    const first = chunker.chunk("00000000-0000-4000-8000-000000000001", blocks);
    const second = chunker.chunk("00000000-0000-4000-8000-000000000001", blocks);
    expect(first.length).toBeGreaterThan(1);
    expect(first.map((chunk) => chunk.id)).toEqual(second.map((chunk) => chunk.id));
    expect(first.every((chunk) => chunk.locator.page === 4)).toBe(true);
  });

  it("groups CSV rows and records the source range", () => {
    const chunker = new FormatAwareChunker(100, 10);
    const chunks = chunker.chunk("00000000-0000-4000-8000-000000000001", [
      { content: "name: Ada", locator: { format: "csv", row_start: 2, row_end: 2 } },
      { content: "name: Grace", locator: { format: "csv", row_start: 3, row_end: 3 } },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.locator).toMatchObject({ row_start: 2, row_end: 3 });
  });
});
