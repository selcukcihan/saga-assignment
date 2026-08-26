import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { pinoHttp } from "pino-http";
import { z } from "zod";
import type { ChatService } from "../application/chat-service.js";
import type { IngestionService } from "../application/ingestion-service.js";
import type { FileStore, JobRepository } from "../application/ports.js";
import { AppError, NotFoundError } from "../domain/errors.js";
import type { SupportedMediaType } from "../domain/documents.js";
import type { Logger } from "../infrastructure/logging/logger.js";
import { errorHandler, notFoundHandler } from "./error-handler.js";

const uuidParameter = z.string().uuid();
const chatBody = z.object({
  question: z.string().trim().min(1).max(10_000),
  session_id: z.string().uuid().optional(),
}).strict();

const mediaTypeByExtension: Record<string, SupportedMediaType> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".csv": "text/csv",
  ".json": "application/json",
};

export interface AppDependencies {
  ingestion: IngestionService;
  chat: ChatService;
  jobs: JobRepository;
  files: FileStore;
  logger: Logger;
  uploadDirectory: string;
  maxUploadBytes: number;
}

function sourceResponse(source: {
  chunkId: string;
  documentId: string;
  filename: string;
  rank: number;
  similarity: number;
  locator: unknown;
  excerpt: string;
}) {
  return {
    chunk_id: source.chunkId,
    document_id: source.documentId,
    filename: source.filename,
    rank: source.rank,
    similarity: source.similarity,
    locator: source.locator,
    excerpt: source.excerpt,
  };
}

export function createApp(dependencies: AppDependencies) {
  mkdirSync(dependencies.uploadDirectory, { recursive: true });
  const storage = multer.diskStorage({
    destination: dependencies.uploadDirectory,
    filename: (_request, file, callback) => {
      callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    },
  });
  const upload = multer({ storage, limits: { files: 1, fileSize: dependencies.maxUploadBytes } });
  const app = express();

  app.disable("x-powered-by");
  app.use(
    pinoHttp({
      logger: dependencies.logger,
      genReqId: (request, response) => {
        const id = randomUUID();
        response.setHeader("x-request-id", id);
        return id;
      },
      customLogLevel: (_request, response, error) =>
        error || response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warn" : "info",
    }),
  );
  app.use((request, response, next) => {
    response.locals["requestId"] = request.id;
    next();
  });
  app.use(express.json({ limit: "64kb" }));

  app.post("/ingest", upload.single("file"), async (request, response) => {
    if (!request.file) throw new AppError("VALIDATION_ERROR", "A multipart file field named 'file' is required", 400);
    try {
      const extension = path.extname(request.file.originalname).toLowerCase();
      const mediaType = mediaTypeByExtension[extension];
      if (!mediaType) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Supported file types are PDF, DOCX, CSV, and JSON", 415);
      const acceptedUploadTypes: Record<SupportedMediaType, readonly string[]> = {
        "application/pdf": ["application/pdf", "application/octet-stream"],
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/octet-stream",
        ],
        "text/csv": ["text/csv", "application/csv", "application/vnd.ms-excel", "application/octet-stream"],
        "application/json": ["application/json", "text/json", "application/octet-stream"],
      };
      if (!acceptedUploadTypes[mediaType].includes(request.file.mimetype)) {
        throw new AppError("UNSUPPORTED_MEDIA_TYPE", "File extension and media type do not match", 415);
      }
      const result = await dependencies.ingestion.ingest({
        filename: path.basename(request.file.originalname),
        mediaType,
        storagePath: request.file.path,
      });
      response.status(202).json({ document_id: result.documentId, job_id: result.jobId, status: result.status });
    } catch (error) {
      await dependencies.files.remove(request.file.path).catch(() => undefined);
      throw error;
    }
  });

  app.get("/jobs/:id", async (request, response) => {
    const id = uuidParameter.parse(request.params["id"]);
    const job = await dependencies.jobs.find(id);
    if (!job) throw new NotFoundError("Job");
    response.json({
      id: job.id,
      document_id: job.documentId,
      status: job.status,
      attempt_count: job.attemptCount,
      max_attempts: job.maxAttempts,
      error: job.error,
      created_at: job.createdAt.toISOString(),
      updated_at: job.updatedAt.toISOString(),
    });
  });

  app.post("/chat", async (request, response) => {
    const body = chatBody.parse(request.body);
    const result = await dependencies.chat.chat({
      question: body.question,
      ...(body.session_id ? { sessionId: body.session_id } : {}),
    });
    response.json({
      session_id: result.sessionId,
      answer: result.answer,
      sources: result.sources.map(sourceResponse),
    });
  });

  app.get("/sessions/:id", async (request, response) => {
    const id = uuidParameter.parse(request.params["id"]);
    const session = await dependencies.chat.getSession(id);
    response.json({
      id: session.id,
      created_at: session.createdAt.toISOString(),
      updated_at: session.updatedAt.toISOString(),
      messages: session.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        created_at: message.createdAt.toISOString(),
        sources: message.sources.map(sourceResponse),
      })),
    });
  });

  app.use(notFoundHandler());
  app.use(errorHandler(dependencies.logger));
  return app;
}
