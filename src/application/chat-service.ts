import type { ChatRepository, EmbeddingGateway, GenerationGateway } from "./ports.js";
import { NotFoundError } from "../domain/errors.js";

const NO_CONTEXT_ANSWER = "I could not find relevant information in the ingested documents.";

export class ChatService {
  constructor(
    private readonly repository: ChatRepository,
    private readonly embeddings: EmbeddingGateway,
    private readonly generation: GenerationGateway,
    private readonly newId: () => string,
    private readonly retrievalLimit: number,
    private readonly historyLimit: number,
  ) {}

  async chat(input: { question: string; sessionId?: string }) {
    const sessionId = input.sessionId ?? this.newId();
    if (input.sessionId) {
      if (!(await this.repository.sessionExists(input.sessionId))) throw new NotFoundError("Session");
    } else {
      await this.repository.createSession(sessionId);
    }

    const history = await this.repository.recentMessages(sessionId, this.historyLimit);
    const [queryEmbedding] = await this.embeddings.embed([input.question]);
    if (!queryEmbedding) throw new Error("Embedding provider returned no query embedding");
    const sources = await this.repository.search(queryEmbedding, this.retrievalLimit);
    const answer = sources.length
      ? await this.generation.generate({
          question: input.question,
          history,
          context: sources.map((source) => ({
            rank: source.rank,
            content: source.content,
            citationLabel: `${source.filename} ${formatLocator(source.locator)}`.trim(),
          })),
        })
      : NO_CONTEXT_ANSWER;

    await this.repository.saveExchange({
      sessionId,
      userMessageId: this.newId(),
      assistantMessageId: this.newId(),
      question: input.question,
      answer,
      sources,
    });

    return { sessionId, answer, sources };
  }

  async getSession(id: string) {
    const session = await this.repository.getSession(id);
    if (!session) throw new NotFoundError("Session");
    return session;
  }
}

function formatLocator(locator: { page?: number; row_start?: number; json_path?: string; paragraph_start?: number }) {
  if (locator.page) return `(page ${locator.page})`;
  if (locator.row_start) return `(row ${locator.row_start})`;
  if (locator.json_path) return `(${locator.json_path})`;
  if (locator.paragraph_start) return `(paragraph ${locator.paragraph_start})`;
  return "";
}
