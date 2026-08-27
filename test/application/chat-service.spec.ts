import { describe, expect, it, vi } from "vitest";
import { ChatService } from "../../src/application/chat-service";
import type { ChatRepository, EmbeddingGateway, GenerationGateway } from "../../src/application/ports";

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
    listSessions: vi.fn().mockResolvedValue([]),
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
    expect(deps.embeddings.embed).toHaveBeenCalledWith(["What does Saga use?"]);
    expect(deps.repository.search).toHaveBeenCalledWith([1, 0], 5);
    expect(deps.generation.generate).toHaveBeenCalledWith(expect.objectContaining({
      question: "What does Saga use?",
      context: [expect.objectContaining({ rank: 1, content: "Saga uses AI" })],
    }));
    expect(deps.repository.saveExchange).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-id" }));
  });

  it("uses only the most recent exchange to contextualize follow-up retrieval", async () => {
    const deps = setup();
    deps.repository.recentMessages.mockResolvedValue([
      { role: "user", content: "An older unrelated question" },
      { role: "assistant", content: "An older unrelated answer" },
      { role: "user", content: "Where did Asya work as an intern?" },
      { role: "assistant", content: "At SabancıDx during Summer 2025." },
    ]);
    const service = new ChatService(deps.repository, deps.embeddings, deps.generation, deps.newId, 5, 10);

    await service.chat({ question: "What did she do there?", sessionId: "session-id" });

    expect(deps.embeddings.embed).toHaveBeenCalledWith([
      "Previous user message: Where did Asya work as an intern?\n" +
      "Previous assistant response: At SabancıDx during Summer 2025.\n" +
      "Current user question: What did she do there?",
    ]);
    expect(deps.generation.generate).toHaveBeenCalledWith(expect.objectContaining({
      question: "What did she do there?",
      history: [
        { role: "user", content: "An older unrelated question" },
        { role: "assistant", content: "An older unrelated answer" },
        { role: "user", content: "Where did Asya work as an intern?" },
        { role: "assistant", content: "At SabancıDx during Summer 2025." },
      ],
    }));
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

  it("lists session summaries without invoking model dependencies", async () => {
    const deps = setup();
    const sessions = [{
      id: "session-id",
      createdAt: new Date("2026-08-26T12:00:00.000Z"),
      updatedAt: new Date("2026-08-26T12:01:00.000Z"),
      messageCount: 4,
    }];
    deps.repository.listSessions.mockResolvedValue(sessions);
    const service = new ChatService(deps.repository, deps.embeddings, deps.generation, deps.newId, 5, 10);

    await expect(service.listSessions()).resolves.toEqual(sessions);
    expect(deps.repository.listSessions).toHaveBeenCalledOnce();
    expect(deps.embeddings.embed).not.toHaveBeenCalled();
    expect(deps.generation.generate).not.toHaveBeenCalled();
  });
});
