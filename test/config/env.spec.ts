import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env";

const required = {
  EMBEDDING_API_KEY: "test",
  GENERATION_API_KEY: "test",
};

describe("loadConfig", () => {
  it("applies the documented defaults", () => {
    const config = loadConfig(required);
    expect(config.embedding.model).toBe("text-embedding-3-small");
    expect(config.embedding.dimensions).toBe(1536);
    expect(config.generation.model).toBe("gpt-5.4-mini");
    expect(config.chunking).toEqual({ targetTokens: 800, overlapTokens: 100 });
    expect(config.pdf).toMatchObject({
      ocrEnabled: true,
      ocrMinNativeCharacters: 100,
      ocrDpi: 200,
      ocrLanguage: "eng",
    });
  });

  it("rejects overlap that is not smaller than the target", () => {
    expect(() =>
      loadConfig({ ...required, CHUNK_TARGET_TOKENS: "100", CHUNK_OVERLAP_TOKENS: "100" }),
    ).toThrow("CHUNK_OVERLAP_TOKENS");
  });

  it("requires provider credentials", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("parses an explicit OCR disable flag rather than coercing the string", () => {
    expect(loadConfig({ ...required, PDF_OCR_ENABLED: "false" }).pdf.ocrEnabled).toBe(false);
  });
});
