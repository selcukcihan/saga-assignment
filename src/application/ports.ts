import type { Citation, DocumentChunk, SourceBlock, SupportedMediaType } from "../domain/documents.js";
import type { ClaimedJob, JobStatus } from "../domain/jobs.js";

export interface EmbeddingGateway {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  embed(inputs: readonly string[]): Promise<number[][]>;
}

export interface GenerationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerationContext {
  rank: number;
  content: string;
  citationLabel: string;
}

export interface GenerationGateway {
  generate(input: {
    question: string;
    history: readonly GenerationMessage[];
    context: readonly GenerationContext[];
  }): Promise<string>;
}

export interface DocumentParser {
  parse(path: string): Promise<SourceBlock[]>;
}

export interface ParserRegistry {
  get(mediaType: SupportedMediaType): DocumentParser;
}

export interface Chunker {
  chunk(documentVersionId: string, blocks: readonly SourceBlock[]): DocumentChunk[];
}

export interface IngestionRepository {
  create(input: {
    documentId: string;
    documentVersionId: string;
    jobId: string;
    filename: string;
    mediaType: SupportedMediaType;
    storagePath: string;
    contentHash: string;
    embeddingProvider: string;
    embeddingModel: string;
    embeddingDimensions: number;
    maxAttempts: number;
  }): Promise<void>;
  removeCreated(documentId: string): Promise<void>;
}

export interface JobView {
  id: string;
  documentId: string;
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobRepository {
  find(id: string): Promise<JobView | null>;
  claim(workerId: string, leaseSeconds: number): Promise<ClaimedJob | null>;
  complete(input: {
    job: ClaimedJob;
    chunks: readonly DocumentChunk[];
    embeddings: readonly number[][];
  }): Promise<void>;
  fail(input: {
    job: ClaimedJob;
    error: string;
    retryable: boolean;
    retryDelaySeconds: number;
  }): Promise<void>;
}

export interface RetrievedChunk extends Citation {
  content: string;
}

export interface ChatRepository {
  sessionExists(sessionId: string): Promise<boolean>;
  createSession(sessionId: string): Promise<void>;
  recentMessages(sessionId: string, limit: number): Promise<GenerationMessage[]>;
  search(queryEmbedding: readonly number[], limit: number): Promise<RetrievedChunk[]>;
  saveExchange(input: {
    sessionId: string;
    userMessageId: string;
    assistantMessageId: string;
    question: string;
    answer: string;
    sources: readonly RetrievedChunk[];
  }): Promise<void>;
  getSession(id: string): Promise<SessionView | null>;
}

export interface SessionView {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: Date;
    sources: Citation[];
  }>;
}

export interface FileStore {
  hash(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  read(path: string): Promise<Uint8Array>;
}
