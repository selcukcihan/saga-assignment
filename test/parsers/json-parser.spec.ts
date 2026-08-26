import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { JsonParser } from "../../src/parsers/json-parser.js";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
const readFileMock = vi.mocked(readFile);

describe("JsonParser", () => {
  it("maps nested values to JSON paths", async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ company: { name: "Saga", products: ["Legal AI"] } }));

    const blocks = await new JsonParser().parse("facts.json");
    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: '{"name":"Saga"}', locator: { format: "json", json_path: "$.company" } }),
      expect.objectContaining({ content: '"Legal AI"', locator: { format: "json", json_path: "$.company.products[0]" } }),
    ]));
  });

  it("translates malformed input into a permanent ingestion error", async () => {
    readFileMock.mockResolvedValue("{");
    await expect(new JsonParser().parse("bad.json")).rejects.toMatchObject({ retryable: false });
  });
});
