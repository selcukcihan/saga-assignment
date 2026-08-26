import type { Database } from "../db/client.js";
import { eq } from "drizzle-orm";
import { documents, documentVersions, ingestionJobs } from "../db/schema.js";
import type { IngestionRepository } from "../../application/ports.js";

export class PostgresIngestionRepository implements IngestionRepository {
  constructor(private readonly database: Database) {}

  async create(input: Parameters<IngestionRepository["create"]>[0]): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(documents).values({
        id: input.documentId,
        filename: input.filename,
        mediaType: input.mediaType,
        storagePath: input.storagePath,
      });
      await transaction.insert(documentVersions).values({
        id: input.documentVersionId,
        documentId: input.documentId,
        contentHash: input.contentHash,
        embeddingProvider: input.embeddingProvider,
        embeddingModel: input.embeddingModel,
        embeddingDimensions: input.embeddingDimensions,
      });
      await transaction.insert(ingestionJobs).values({
        id: input.jobId,
        documentVersionId: input.documentVersionId,
        maxAttempts: input.maxAttempts,
      });
    });
  }

  async removeCreated(documentId: string): Promise<void> {
    await this.database.delete(documents).where(eq(documents.id, documentId));
  }
}
