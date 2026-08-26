import type { Pool, PoolClient } from "pg";
import type {
  ChatRepository,
  GenerationMessage,
  RetrievedChunk,
  SessionView,
} from "../../application/ports.js";
import type { Citation, SourceLocator } from "../../domain/documents.js";

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: Date;
}

interface SearchRow {
  chunk_id: string;
  document_id: string;
  filename: string;
  content: string;
  source_locator: SourceLocator;
  similarity: number;
}

interface SourceRow {
  message_id: string;
  chunk_id: string;
  document_id: string;
  filename: string;
  rank: number;
  similarity: number;
  source_locator: SourceLocator;
  content: string;
}

function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original transaction error.
  }
}

export class PostgresChatRepository implements ChatRepository {
  constructor(
    private readonly pool: Pool,
    private readonly embeddingModel: string,
    private readonly embeddingDimensions: number,
  ) {}

  async sessionExists(sessionId: string): Promise<boolean> {
    const result = await this.pool.query("SELECT 1 FROM sessions WHERE id = $1", [sessionId]);
    return result.rowCount === 1;
  }

  async createSession(sessionId: string): Promise<void> {
    await this.pool.query("INSERT INTO sessions (id) VALUES ($1)", [sessionId]);
  }

  async recentMessages(sessionId: string, limit: number): Promise<GenerationMessage[]> {
    const result = await this.pool.query<Pick<MessageRow, "role" | "content">>(
      `SELECT role, content
         FROM messages
        WHERE session_id = $1
        ORDER BY created_at DESC, CASE role WHEN 'user' THEN 0 ELSE 1 END DESC, id DESC
        LIMIT $2`,
      [sessionId, limit],
    );
    return result.rows.reverse();
  }

  async search(queryEmbedding: readonly number[], limit: number): Promise<RetrievedChunk[]> {
    const result = await this.pool.query<SearchRow>(
      `SELECT c.id AS chunk_id, d.id AS document_id, d.filename, c.content,
              c.source_locator, 1 - (c.embedding <=> $1::vector) AS similarity
         FROM chunks c
         JOIN document_versions v ON v.id = c.document_version_id
         JOIN documents d ON d.id = v.document_id
        WHERE v.status = 'ready'
          AND v.embedding_model = $2
          AND v.embedding_dimensions = $3
        ORDER BY c.embedding <=> $1::vector
        LIMIT $4`,
      [vectorLiteral(queryEmbedding), this.embeddingModel, this.embeddingDimensions, limit],
    );
    return result.rows.map((row, index) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      filename: row.filename,
      rank: index + 1,
      similarity: Number(row.similarity),
      locator: row.source_locator,
      excerpt: row.content.slice(0, 240),
      content: row.content,
    }));
  }

  async saveExchange(input: Parameters<ChatRepository["saveExchange"]>[0]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO messages (id, session_id, role, content) VALUES ($1, $2, 'user', $3)",
        [input.userMessageId, input.sessionId, input.question],
      );
      await client.query(
        "INSERT INTO messages (id, session_id, role, content) VALUES ($1, $2, 'assistant', $3)",
        [input.assistantMessageId, input.sessionId, input.answer],
      );
      for (const source of input.sources) {
        await client.query(
          `INSERT INTO message_sources (message_id, chunk_id, rank, similarity)
           VALUES ($1, $2, $3, $4)`,
          [input.assistantMessageId, source.chunkId, source.rank, source.similarity],
        );
      }
      await client.query("UPDATE sessions SET updated_at = now() WHERE id = $1", [input.sessionId]);
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getSession(id: string): Promise<SessionView | null> {
    const sessionResult = await this.pool.query<{ id: string; created_at: Date; updated_at: Date }>(
      "SELECT id, created_at, updated_at FROM sessions WHERE id = $1",
      [id],
    );
    const session = sessionResult.rows[0];
    if (!session) return null;

    const messageResult = await this.pool.query<MessageRow>(
      `SELECT id, role, content, created_at
         FROM messages
        WHERE session_id = $1
        ORDER BY created_at, CASE role WHEN 'user' THEN 0 ELSE 1 END, id`,
      [id],
    );
    const sourceResult = await this.pool.query<SourceRow>(
      `SELECT ms.message_id, c.id AS chunk_id, d.id AS document_id, d.filename,
              ms.rank, ms.similarity, c.source_locator, c.content
         FROM message_sources ms
         JOIN chunks c ON c.id = ms.chunk_id
         JOIN document_versions v ON v.id = c.document_version_id
         JOIN documents d ON d.id = v.document_id
         JOIN messages m ON m.id = ms.message_id
        WHERE m.session_id = $1
        ORDER BY ms.message_id, ms.rank`,
      [id],
    );

    const sourcesByMessage = new Map<string, Citation[]>();
    for (const row of sourceResult.rows) {
      const source: Citation = {
        chunkId: row.chunk_id,
        documentId: row.document_id,
        filename: row.filename,
        rank: row.rank,
        similarity: Number(row.similarity),
        locator: row.source_locator,
        excerpt: row.content.slice(0, 240),
      };
      const existing = sourcesByMessage.get(row.message_id) ?? [];
      existing.push(source);
      sourcesByMessage.set(row.message_id, existing);
    }

    return {
      id: session.id,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      messages: messageResult.rows.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.created_at,
        sources: sourcesByMessage.get(message.id) ?? [],
      })),
    };
  }
}
