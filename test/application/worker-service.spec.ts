import { describe, expect, it, vi } from "vitest";
import { WorkerService } from "../../src/application/worker-service.js";
import type { Chunker, EmbeddingGateway, JobRepository, ParserRegistry } from "../../src/application/ports.js";
import { ProviderError } from "../../src/domain/errors.js";

const job = {
  id: "job",
  documentVersionId: "version",
  documentId: "document",
  filename: "facts.json",
  mediaType: "application/json",
  storagePath: "/data/facts.json",
  attemptCount: 1,
  maxAttempts: 3,
};

function setup() {
  const parser = { parse: vi.fn().mockResolvedValue([{ content: "fact", locator: { format: "json", json_path: "$" } }]) };
  const jobs = { find: vi.fn(), claim: vi.fn().mockResolvedValue(job), complete: vi.fn(), fail: vi.fn() } satisfies JobRepository;
  const parsers = { get: vi.fn(() => parser) } satisfies ParserRegistry;
  const chunks = [{ id: "chunk", ordinal: 0, content: "fact", contentHash: "hash", locator: { format: "json" as const, json_path: "$" } }];
  const chunker = { chunk: vi.fn(() => chunks) } satisfies Chunker;
  const embeddings = { provider: "test", model: "test", dimensions: 2, embed: vi.fn().mockResolvedValue([[1, 0]]) } satisfies EmbeddingGateway;
  return { parser, jobs, parsers, chunker, chunks, embeddings };
}

describe("WorkerService", () => {
  it("processes claimed work outside the repository claim and completes it", async () => {
    const deps = setup();
    const service = new WorkerService(deps.jobs, deps.parsers, deps.chunker, deps.embeddings, "worker", 120, 2);

    await expect(service.processNext()).resolves.toBe(true);
    expect(deps.jobs.complete).toHaveBeenCalledWith({ job, chunks: deps.chunks, embeddings: [[1, 0]] });
    expect(deps.jobs.fail).not.toHaveBeenCalled();
  });

  it("schedules retryable provider failures with exponential delay", async () => {
    const deps = setup();
    deps.embeddings.embed.mockRejectedValue(new ProviderError("rate limited", true));
    const service = new WorkerService(deps.jobs, deps.parsers, deps.chunker, deps.embeddings, "worker", 120, 2);

    await service.processNext();
    expect(deps.jobs.fail).toHaveBeenCalledWith({
      job,
      error: "AI provider request failed",
      retryable: true,
      retryDelaySeconds: 2,
    });
  });

  it("does nothing when no job is available", async () => {
    const deps = setup();
    deps.jobs.claim.mockResolvedValue(null);
    const service = new WorkerService(deps.jobs, deps.parsers, deps.chunker, deps.embeddings, "worker", 120, 2);

    await expect(service.processNext()).resolves.toBe(false);
    expect(deps.parser.parse).not.toHaveBeenCalled();
  });
});
