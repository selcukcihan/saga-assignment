import { z } from "zod";

const integerFromEnv = (defaultValue: number, minimum = 1) =>
  z.coerce.number().int().min(minimum).default(defaultValue);

const baseUrl = z.string().url().transform((value) => value.replace(/\/$/, ""));
const booleanFromEnv = (defaultValue: boolean) =>
  z.enum(["true", "false"]).default(String(defaultValue) as "true" | "false").transform((value) => value === "true");

const databaseSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://saga:saga@localhost:5432/saga"),
  DB_POOL_MAX: integerFromEnv(10),
  DB_CONNECTION_TIMEOUT_MS: integerFromEnv(5_000),
  DB_IDLE_TIMEOUT_MS: integerFromEnv(30_000),
  DB_STATEMENT_TIMEOUT_MS: integerFromEnv(30_000),
});

const configSchema = databaseSchema.extend({
  PORT: integerFromEnv(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  UPLOAD_DIR: z.string().min(1).default("./uploads"),
  MAX_UPLOAD_BYTES: integerFromEnv(10 * 1024 * 1024),
  PDF_OCR_ENABLED: booleanFromEnv(true),
  PDF_OCR_MIN_NATIVE_CHARACTERS: integerFromEnv(100, 0),
  PDF_OCR_DPI: z.coerce.number().int().min(72).max(600).default(200),
  PDF_OCR_LANGUAGE: z.string().regex(/^[a-z0-9_+.-]+$/i).default("eng"),
  PDF_OCR_TIMEOUT_MS: integerFromEnv(60_000),

  EMBEDDING_BASE_URL: baseUrl.default("https://api.openai.com/v1"),
  EMBEDDING_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: integerFromEnv(1536),
  EMBEDDING_BATCH_SIZE: integerFromEnv(64),
  EMBEDDING_TIMEOUT_MS: integerFromEnv(30_000),

  GENERATION_BASE_URL: baseUrl.default("https://api.openai.com/v1"),
  GENERATION_API_KEY: z.string().min(1),
  GENERATION_MODEL: z.string().min(1).default("gpt-5.4-mini"),
  GENERATION_TIMEOUT_MS: integerFromEnv(60_000),

  CHUNK_TARGET_TOKENS: integerFromEnv(800),
  CHUNK_OVERLAP_TOKENS: integerFromEnv(100, 0),
  RETRIEVAL_LIMIT: integerFromEnv(5),
  CHAT_HISTORY_LIMIT: integerFromEnv(10),

  WORKER_POLL_INTERVAL_MS: integerFromEnv(500),
  WORKER_LEASE_SECONDS: integerFromEnv(120),
  WORKER_MAX_ATTEMPTS: integerFromEnv(3),
  WORKER_RETRY_BASE_SECONDS: integerFromEnv(2),
});

export interface DatabaseConfig {
  url: string;
  poolMax: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  statementTimeoutMs: number;
}

function mapDatabaseConfig(parsed: z.infer<typeof databaseSchema>): DatabaseConfig {
  return {
    url: parsed.DATABASE_URL,
    poolMax: parsed.DB_POOL_MAX,
    connectionTimeoutMs: parsed.DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: parsed.DB_IDLE_TIMEOUT_MS,
    statementTimeoutMs: parsed.DB_STATEMENT_TIMEOUT_MS,
  };
}

export function loadDatabaseConfig(environment: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return mapDatabaseConfig(databaseSchema.parse(environment));
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.parse(environment);
  if (parsed.CHUNK_OVERLAP_TOKENS >= parsed.CHUNK_TARGET_TOKENS) {
    throw new Error("CHUNK_OVERLAP_TOKENS must be less than CHUNK_TARGET_TOKENS");
  }

  return {
    server: { port: parsed.PORT, host: parsed.HOST },
    logLevel: parsed.LOG_LEVEL,
    database: mapDatabaseConfig(parsed),
    upload: { directory: parsed.UPLOAD_DIR, maxBytes: parsed.MAX_UPLOAD_BYTES },
    pdf: {
      ocrEnabled: parsed.PDF_OCR_ENABLED,
      ocrMinNativeCharacters: parsed.PDF_OCR_MIN_NATIVE_CHARACTERS,
      ocrDpi: parsed.PDF_OCR_DPI,
      ocrLanguage: parsed.PDF_OCR_LANGUAGE,
      ocrTimeoutMs: parsed.PDF_OCR_TIMEOUT_MS,
    },
    embedding: {
      baseUrl: parsed.EMBEDDING_BASE_URL,
      apiKey: parsed.EMBEDDING_API_KEY,
      model: parsed.EMBEDDING_MODEL,
      dimensions: parsed.EMBEDDING_DIMENSIONS,
      batchSize: parsed.EMBEDDING_BATCH_SIZE,
      timeoutMs: parsed.EMBEDDING_TIMEOUT_MS,
    },
    generation: {
      baseUrl: parsed.GENERATION_BASE_URL,
      apiKey: parsed.GENERATION_API_KEY,
      model: parsed.GENERATION_MODEL,
      timeoutMs: parsed.GENERATION_TIMEOUT_MS,
    },
    chunking: {
      targetTokens: parsed.CHUNK_TARGET_TOKENS,
      overlapTokens: parsed.CHUNK_OVERLAP_TOKENS,
    },
    chat: { retrievalLimit: parsed.RETRIEVAL_LIMIT, historyLimit: parsed.CHAT_HISTORY_LIMIT },
    worker: {
      pollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS,
      leaseSeconds: parsed.WORKER_LEASE_SECONDS,
      maxAttempts: parsed.WORKER_MAX_ATTEMPTS,
      retryBaseSeconds: parsed.WORKER_RETRY_BASE_SECONDS,
    },
  } as const;
}

export type AppConfig = ReturnType<typeof loadConfig>;
