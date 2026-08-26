import { describe, expect, it, vi } from "vitest";
import { ChatService } from "../../src/application/chat-service.js";
import type { ChatRepository, EmbeddingGateway, GenerationGateway } from "../../src/application/ports.js";

function setup() {
  const source = {
    chunkId: "chunk",
    documentId: "document",
    filename: "facts.json",
    rank: 1,
    similarity: 0.9,
    locator: { format: "json" as const, json_path: "$.company" },
    excerpt: "Saga uses AI",
    content: "Saga uses AI",
  };
  const repository = {
    sessionExists: vi.fn().mockResolvedValue(true),
    createSession: vi.fn(),
    recentMessages: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([source]),
    saveExchange: vi.fn(),
    getSession: vi.fn(),
  } satisfies ChatRepository;
  const embeddings = { provider: "test", model: "test", dimensions: 2, embed: vi.fn().mockResolvedValue([[1, 0]]) } satisfies EmbeddingGateway;
  const generation = { generate: vi.fn().mockResolvedValue("Saga uses AI [1]") } satisfies GenerationGateway;
  const ids = ["session-id", "user-message", "assistant-message"];
  return { repository, embeddings, generation, source, newId: vi.fn(() => ids.shift()!) };
}

describe("ChatService", () => {
  it("creates a session, retrieves evidence, generates, and saves one exchange", async () => {
    const deps = setup();
    const service = new ChatService(deps.repository, deps.embeddings, deps.generation, deps.newId, 5, 10);
    const result = await service.chat({ question: "What does Saga use?" });

    expect(result).toEqual({ sessionId: "session-id", answer: "Saga uses AI [1]", sources: [deps.source] });
    expect(deps.repository.createSession).toHaveBeenCalledWith("session-id");
    expect(deps.repository.search).toHaveBeenCalledWith([1, 0], 5);
    expect(deps.generation.generate).toHaveBeenCalledWith(expect.objectContaining({
      question: "What does Saga use?",
      context: [expect.objectContaining({ rank: 1, content: "Saga uses AI" })],
    }));
    expect(deps.repository.saveExchange).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-id" }));
  });

  it("does not call generation when retrieval returns no context", async () => {
    const deps = setup();
    deps.repository.search.mockResolvedValue([]);
    const service = new ChatService(deps.repository, deps.embeddings, deps.generation, deps.newId, 5, 10);
    const result = await service.chat({ question: "Unknown?" });

    expect(result.answer).toContain("could not find relevant information");
    expect(deps.generation.generate).not.toHaveBeenCalled();
  });

  it("rejects an unknown supplied session before model calls", async () => {
    const deps = setup();
    deps.repository.sessionExists.mockResolvedValue(false);
    const service = new ChatService(deps.repository, deps.embeddings, deps.generation, deps.newId, 5, 10);

    await expect(service.chat({ question: "Hello", sessionId: "missing" })).rejects.toMatchObject({ status: 404 });
    expect(deps.embeddings.embed).not.toHaveBeenCalled();
  });
});
