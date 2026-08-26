import type { EmbeddingGateway, FileStore, IngestionRepository } from "./ports.js";
import type { SupportedMediaType } from "../domain/documents.js";

export interface IngestCommand {
  filename: string;
  mediaType: SupportedMediaType;
  storagePath: string;
}

export class IngestionService {
  constructor(
    private readonly repository: IngestionRepository,
    private readonly files: FileStore,
    private readonly embeddings: EmbeddingGateway,
    private readonly newId: () => string,
    private readonly maxAttempts: number,
  ) {}

  async ingest(command: IngestCommand): Promise<{ documentId: string; jobId: string; status: "queued" }> {
    const documentId = this.newId();
    const documentVersionId = this.newId();
    const jobId = this.newId();

    try {
      const contentHash = await this.files.hash(command.storagePath);
      await this.repository.create({
        documentId,
        documentVersionId,
        jobId,
        filename: command.filename,
        mediaType: command.mediaType,
        storagePath: command.storagePath,
        contentHash,
        embeddingProvider: this.embeddings.provider,
        embeddingModel: this.embeddings.model,
        embeddingDimensions: this.embeddings.dimensions,
        maxAttempts: this.maxAttempts,
      });
      return { documentId, jobId, status: "queued" };
    } catch (error) {
      await this.files.remove(command.storagePath).catch(() => undefined);
      throw error;
    }
  }
}
