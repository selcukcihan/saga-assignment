import { describe, expect, it, vi } from "vitest";
import { IngestionService } from "../../src/application/ingestion-service.js";
import type { EmbeddingGateway, FileStore, IngestionRepository } from "../../src/application/ports.js";

function dependencies() {
  const repository = { create: vi.fn(), removeCreated: vi.fn() } satisfies IngestionRepository;
  const files = {
    hash: vi.fn().mockResolvedValue("hash"),
    remove: vi.fn().mockResolvedValue(undefined),
    read: vi.fn(),
  } satisfies FileStore;
  const embeddings = {
    provider: "test",
    model: "test-model",
    dimensions: 3,
    embed: vi.fn(),
  } satisfies EmbeddingGateway;
  const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
  return { repository, files, embeddings, newId: vi.fn(() => ids.shift()!), service: undefined as unknown as IngestionService };
}

describe("IngestionService", () => {
  it("persists document, version, and queued job metadata", async () => {
    const deps = dependencies();
    const service = new IngestionService(deps.repository, deps.files, deps.embeddings, deps.newId, 3);
    const result = await service.ingest({ filename: "facts.json", mediaType: "application/json", storagePath: "/data/facts.json" });

    expect(result).toEqual({
      documentId: "00000000-0000-4000-8000-000000000001",
      jobId: "00000000-0000-4000-8000-000000000003",
      status: "queued",
    });
    expect(deps.repository.create).toHaveBeenCalledWith(expect.objectContaining({
      contentHash: "hash",
      embeddingModel: "test-model",
      embeddingDimensions: 3,
      maxAttempts: 3,
    }));
    expect(deps.files.remove).not.toHaveBeenCalled();
  });

  it("removes the stored upload when persistence fails", async () => {
    const deps = dependencies();
    deps.repository.create.mockRejectedValue(new Error("database down"));
    const service = new IngestionService(deps.repository, deps.files, deps.embeddings, deps.newId, 3);

    await expect(service.ingest({ filename: "facts.json", mediaType: "application/json", storagePath: "/data/facts.json" })).rejects.toThrow("database down");
    expect(deps.files.remove).toHaveBeenCalledWith("/data/facts.json");
  });
});
