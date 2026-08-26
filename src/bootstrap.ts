import { randomUUID } from "node:crypto";
import { ChatService } from "./application/chat-service.js";
import { IngestionService } from "./application/ingestion-service.js";
import { loadConfig } from "./config/env.js";
import { OpenAICompatibleEmbeddingGateway, OpenAICompatibleGenerationGateway } from "./infrastructure/ai/openai-compatible-gateways.js";
import { createDatabase } from "./infrastructure/db/client.js";
import { NodeFileStore } from "./infrastructure/files/node-file-store.js";
import { createLogger } from "./infrastructure/logging/logger.js";
import { PostgresChatRepository } from "./infrastructure/repositories/postgres-chat-repository.js";
import { PostgresIngestionRepository } from "./infrastructure/repositories/postgres-ingestion-repository.js";
import { PostgresJobRepository } from "./infrastructure/repositories/postgres-job-repository.js";
import { FormatAwareChunker } from "./parsers/chunker.js";
import { DefaultParserRegistry } from "./parsers/registry.js";

export function bootstrap() {
  const config = loadConfig();
  const database = createDatabase(config.database);
  const logger = createLogger(config.logLevel);
  const files = new NodeFileStore();
  const embeddings = new OpenAICompatibleEmbeddingGateway(config.embedding, config.embedding.batchSize);
  const generation = new OpenAICompatibleGenerationGateway(config.generation);
  const jobs = new PostgresJobRepository(database.pool);
  const chatRepository = new PostgresChatRepository(
    database.pool,
    config.embedding.model,
    config.embedding.dimensions,
  );
  const ingestion = new IngestionService(
    new PostgresIngestionRepository(database.db),
    files,
    embeddings,
    randomUUID,
    config.worker.maxAttempts,
  );
  const chat = new ChatService(
    chatRepository,
    embeddings,
    generation,
    randomUUID,
    config.chat.retrievalLimit,
    config.chat.historyLimit,
  );
  return {
    config,
    database,
    logger,
    files,
    embeddings,
    jobs,
    ingestion,
    chat,
    chunker: new FormatAwareChunker(config.chunking.targetTokens, config.chunking.overlapTokens),
    parsers: new DefaultParserRegistry(),
  };
}
