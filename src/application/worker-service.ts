import type { Chunker, EmbeddingGateway, JobRepository, ParserRegistry } from "./ports";
import { isSupportedMediaType } from "../domain/documents";
import { PermanentIngestionError, ProviderError, safeIngestionError } from "../domain/errors";

export class WorkerService {
  constructor(
    private readonly jobs: JobRepository,
    private readonly parsers: ParserRegistry,
    private readonly chunker: Chunker,
    private readonly embeddings: EmbeddingGateway,
    private readonly workerId: string,
    private readonly leaseSeconds: number,
    private readonly retryBaseSeconds: number,
  ) {}

  async processNext(): Promise<boolean> {
    const job = await this.jobs.claim(this.workerId, this.leaseSeconds);
    if (!job) return false;

    try {
      if (!isSupportedMediaType(job.mediaType)) throw new PermanentIngestionError("Unsupported document type");
      const blocks = await this.parsers.get(job.mediaType).parse(job.storagePath);
      if (blocks.length === 0) throw new PermanentIngestionError("Document contains no extractable content");
      const chunks = this.chunker.chunk(job.documentVersionId, blocks);
      if (chunks.length === 0) throw new PermanentIngestionError("Document contains no indexable content");
      const embeddings = await this.embeddings.embed(chunks.map((chunk) => chunk.content));
      await this.jobs.complete({ job, chunks, embeddings });
    } catch (error) {
      const retryable = error instanceof ProviderError && error.retryable;
      const retryDelaySeconds = this.retryBaseSeconds * 2 ** Math.max(0, job.attemptCount - 1);
      await this.jobs.fail({
        job,
        error: safeIngestionError(error),
        retryable,
        retryDelaySeconds,
      });
    }
    return true;
  }
}
