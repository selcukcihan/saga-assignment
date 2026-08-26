import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { SourceLocator } from "../../domain/documents.js";

export const documentStatus = pgEnum("document_status", ["pending", "processing", "ready", "failed"]);
export const jobStatus = pgEnum("job_status", ["queued", "processing", "completed", "failed"]);
export const messageRole = pgEnum("message_role", ["user", "assistant"]);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey(),
  filename: text("filename").notNull(),
  mediaType: text("media_type").notNull(),
  storagePath: text("storage_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey(),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    status: documentStatus("status").default("pending").notNull(),
    contentHash: text("content_hash").notNull(),
    embeddingProvider: text("embedding_provider").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    embeddingDimensions: integer("embedding_dimensions").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_versions_document_hash_idx").on(table.documentId, table.contentHash),
    check("document_versions_embedding_dimensions_check", sql`${table.embeddingDimensions} > 0`),
  ],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceLocator: jsonb("source_locator").$type<SourceLocator>().notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("chunks_version_ordinal_idx").on(table.documentVersionId, table.ordinal),
    index("chunks_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

export const ingestionJobs = pgTable(
  "ingestion_jobs",
  {
    id: uuid("id").primaryKey(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    status: jobStatus("status").default("queued").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ingestion_jobs_claim_idx").on(table.status, table.availableAt),
    check("ingestion_jobs_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check("ingestion_jobs_max_attempts_check", sql`${table.maxAttempts} > 0`),
  ],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("messages_session_created_idx").on(table.sessionId, table.createdAt)],
);

export const messageSources = pgTable(
  "message_sources",
  {
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").notNull().references(() => chunks.id, { onDelete: "restrict" }),
    rank: integer("rank").notNull(),
    similarity: real("similarity").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.chunkId] }),
    uniqueIndex("message_sources_message_rank_idx").on(table.messageId, table.rank),
  ],
);
