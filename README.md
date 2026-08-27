# Multi-Source Knowledge API

> A self-contained conversational RAG service with asynchronous multi-format ingestion, source citations, and conversation-aware retrieval.

This repository contains a conversational retrieval-augmented generation (RAG) API for ingesting PDF, DOCX, CSV, and JSON documents and answering questions with source citations and conversation context.

`docker compose up --build` starts PostgreSQL/pgvector, runs the Drizzle migration once, and then starts independent API and worker processes with shared upload storage.

## Quick Start and Manual Demo

The shortest path uses the JSON fixture included in this repository. Docker is the only application runtime dependency; the application services, PostgreSQL/pgvector, migrations, PDF/OCR tools, and Node.js runtime are contained in the Compose setup.

Create the local configuration, set a real OpenAI API key, and start the stack:

```bash
cp .env.example .env
# Edit .env and replace OPENAI_API_KEY=replace-with-your-key
docker compose up --build
```

In a second terminal, upload the bundled fixture:

```bash
curl --fail-with-body -X POST http://localhost:3000/ingest \
  -F 'file=@./test/files/asya-genc-cv.json'
```

The API returns `202 Accepted` with `document_id`, `job_id`, and `status`. Copy the returned `job_id` and poll until the job is `completed`:

```bash
JOB_ID='paste-the-returned-job-id-here'
curl --fail-with-body "http://localhost:3000/jobs/$JOB_ID"
```

Ask a question grounded in that document:

```bash
curl --fail-with-body -X POST http://localhost:3000/chat \
  -H 'content-type: application/json' \
  -d '{"question":"At which company and during what period did Asya Genç work as a Software Engineering Intern?"}'
```

The answer should identify SabancıDx and Summer 2025 and include a source whose filename is `asya-genc-cv.json` and whose JSON locator is `$.experience[0]`. Copy the returned `session_id` to continue the conversation with an ambiguous follow-up:

```bash
SESSION_ID='paste-the-returned-session-id-here'
curl --fail-with-body -X POST http://localhost:3000/chat \
  -H 'content-type: application/json' \
  -d "{\"session_id\":\"$SESSION_ID\",\"question\":\"What did she do there?\"}"
```

Inspect the persisted conversation and its citations:

```bash
curl --fail-with-body "http://localhost:3000/sessions/$SESSION_ID"
```

The commands above call the configured model providers and therefore require valid provider credentials. The end-to-end test profile instead uses a deterministic local OpenAI-compatible fake and needs no API key; see [Test Commands](#test-commands).

## Capabilities and Limits

The service provides:

- Ingest PDF, DOCX, CSV, and JSON documents.
- Process ingestion asynchronously and expose job status.
- Parse, normalize, chunk, and embed document content.
- Store relational application data and vector embeddings.
- Perform vector-based semantic retrieval.
- Answer questions using retrieved context and return source citations.
- Track conversations by `session_id`.
- Use the most recent exchange to retrieve evidence for ambiguous follow-up questions.
- Persist user queries, generated answers, and their sources.
- Provide validation, error handling, tests, Docker setup, API documentation, and architectural documentation.

The current retrieval pipeline does not include hybrid BM25 search, LLM query rewriting, smart routing, SSE streaming, re-ranking, Redis caching, or a formal retrieval evaluation suite.

## Feature Matrix

| Capability | Implementation | Verification |
| --- | --- | --- |
| PDF, DOCX, CSV, and JSON ingestion | Ingestion API, native parsers, selective local PDF OCR, ingestion worker | Implemented; all formats E2E tested and OCR fallback unit tested |
| Asynchronous ingestion with job status | PostgreSQL-backed job queue and `GET /jobs/{id}` | Implemented and E2E tested |
| Chunk storage with embeddings | PostgreSQL `chunks` table with a pgvector column | Implemented with Drizzle migration |
| Session management | `POST /chat` creates a session when `session_id` is omitted | Implemented and E2E tested |
| Chat history including sources | Chat messages and citation records | Implemented and E2E tested |
| Context-aware follow-up retrieval | Retrieval query includes the most recent user/assistant exchange | Implemented and E2E tested |
| `POST /ingest` | HTTP API | Implemented |
| `POST /chat` | HTTP API | Implemented |
| `GET /sessions` | HTTP API | Implemented and E2E tested |
| `GET /sessions/{id}` | HTTP API | Implemented |
| Chunking strategy and rationale | Format-aware chunking with an 800-token target and 100-token overlap | Configurable default; evaluation recommended |
| Vector semantic search | pgvector HNSW cosine search, top 5 by default | Configurable default; evaluation recommended |
| Source citations | Format-specific source-location metadata and chat response contract | Implemented and persisted |
| Database schema | Drizzle schema and migrations | Implemented |
| Validation and error handling | Zod at boundaries and centralized error mapping | Implemented |
| Docker setup | One application image, API and worker services, pgvector PostgreSQL, and a shared upload volume | Implemented and verified |
| Tests | Mirrored unit tests and Compose-based end-to-end tests using Vitest | Implemented |

## Architecture Overview

The architecture separates HTTP transport, application workflows, domain concepts, and infrastructure integrations. The API acknowledges ingestion quickly; a durable worker performs parsing and embedding outside the request lifecycle.

```mermaid
flowchart LR
    Client["API client"]
    API["Express API"]
    DB[("PostgreSQL + pgvector")]
    Worker["Ingestion worker"]
    Files[("Shared Docker upload volume")]
    Embeddings["Configurable embedding provider"]
    LLM["Configurable generation provider"]

    Client -->|"POST /ingest"| API
    API -->|"document metadata + queued job"| DB
    API -->|"uploaded bytes"| Files
    Worker -->|"claim job with SKIP LOCKED"| DB
    Worker -->|"read document"| Files
    Worker -->|"embed chunks"| Embeddings
    Worker -->|"chunks + vectors + status"| DB

    Client -->|"POST /chat"| API
    DB -->|"most recent exchange"| API
    API -->|"embed contextual retrieval query"| Embeddings
    API -->|"cosine similarity search"| DB
    API -->|"question + retrieved context"| LLM
    API -->|"messages + citations"| DB
    API -->|"answer + sources"| Client

    Client -->|"GET /sessions or /sessions/:id"| API
    API -->|"session summaries or conversation history"| DB
```

### Component Responsibilities

| Component | Responsibility |
| --- | --- |
| Express API | HTTP routing, multipart upload handling, request validation, response mapping, and error translation |
| Ingestion application service | Validate ingestion commands, create document/job records, and return an asynchronous acknowledgement |
| Ingestion worker | Claim jobs, parse files, normalize content, create chunks, request embeddings, persist indexed chunks, and manage retries/failures |
| Parser implementations | Convert each supported file format into a common normalized representation while preserving source locations; OCR image-backed PDF pages locally when needed |
| Chunking component | Apply an approved format-aware chunking policy and produce deterministic chunks |
| Embedding gateway | Isolate the external embedding API and support batching, timeouts, and provider error translation |
| Retrieval repository | Perform pgvector similarity search and return ranked chunks with citation metadata |
| Chat application service | Load session context, retrieve evidence, call the generation model, validate citations, and persist the interaction |
| Generation gateway | Isolate the LLM provider and enforce the answer-with-evidence prompt contract |
| PostgreSQL | Store documents, chunks, embeddings, sessions, messages, citations, and durable ingestion jobs |

These responsibilities map to the implemented `src/api`, `src/application`, `src/domain`, `src/infrastructure`, `src/parsers`, and `src/worker` modules.

## Workflows

### Asynchronous Ingestion

1. The client uploads a supported document to `POST /ingest`.
2. The API validates the request and persists the uploaded file using the approved storage strategy.
3. In a short database transaction, the API creates a document record and a queued ingestion-job record.
4. The API returns `202 Accepted` with stable document and job identifiers.
5. A worker claims an eligible job using a short PostgreSQL transaction and `FOR UPDATE SKIP LOCKED`.
6. Outside the claim transaction, the worker parses and normalizes the document, creates chunks, and requests embeddings in batches.
7. In a completion transaction, the worker inserts the chunks and embeddings and marks the document `ready` and the job `completed`.
8. If processing fails, the worker records a sanitized error and either schedules a retry or marks the job `failed`, according to the retry policy.

External parsing and embedding calls do not occur inside a long-running database transaction. Stable identifiers and idempotent inserts/upserts allow a retried job to converge without duplicating chunks.

The worker runs as a separate Docker Compose service using the same application image as the API. Operational defaults are a 500 ms polling interval, three attempts with exponential backoff, and a 120-second recoverable processing lease. These values are environment-configurable.

### Conversational Retrieval

1. The client submits a question and an optional `session_id` to `POST /chat`.
2. The chat service creates a session when `session_id` is omitted, or loads the existing session when it is supplied.
3. For a continuing session, the service deterministically combines the most recent user/assistant exchange with the current question. A first-turn question remains unchanged.
4. The resulting retrieval query is embedded using the same embedding model and version used for document chunks.
5. The retrieval repository searches the shared corpus of all `ready` document versions and returns the five nearest chunks by default.
6. The generation model receives the original question, the configured conversation-history window, and the retrieved chunks.
7. The service produces an answer whose citations refer only to retrieved chunks.
8. The user message, assistant answer, and source references are persisted before the response is returned.

The service performs a single vector retrieval step. LLM-based rewriting, hybrid search, re-ranking, and streaming are not part of the pipeline.

### Conversation History

`GET /sessions` returns lightweight summaries ordered by most recent activity so clients can discover session identifiers. `GET /sessions/{id}` returns the complete ordered conversation history, including user messages, assistant responses, and the sources associated with each response. Pagination is omitted to keep the API small; a larger deployment should use cursor pagination. An unknown session identifier returns `404 Not Found`.

## API Surface

The API surface is intentionally small and covers ingestion, job status, chat, and conversation inspection.

| Method and path | Purpose | Expected success status | Status |
| --- | --- | --- | --- |
| `POST /ingest` | Upload one document and enqueue processing | `202 Accepted` | Implemented |
| `GET /jobs/{id}` | Retrieve ingestion progress and sanitized failure information | `200 OK` | Implemented |
| `POST /chat` | Ask a question across all ready documents; create a session if `session_id` is omitted | `200 OK` | Implemented |
| `GET /sessions` | List session summaries, newest activity first | `200 OK` | Implemented |
| `GET /sessions/{id}` | Retrieve the complete ordered history and citations | `200 OK` | Implemented |

Common error categories are invalid input (`400`), unsupported document type (`415`), missing resource (`404`), payload too large (`413`), dependency failure (`503`), and unexpected server failure (`500`).

### `POST /ingest`

Send `multipart/form-data` with exactly one file in the `file` field. The extension and media type must identify PDF, DOCX, CSV, or JSON. The default size limit is 10 MiB.

```bash
curl -X POST http://localhost:3000/ingest \
  -F 'file=@./test/files/asya-genc-cv.json'
```

```json
{
  "document_id": "51ca0f12-2ca7-4bce-a7f2-daf768b17eef",
  "job_id": "3797131f-c2cb-4e7d-b670-62fef911c141",
  "status": "queued"
}
```

### `GET /jobs/{id}`

Poll until `status` is `completed` or `failed`. `attempt_count` increments when a worker claims the job. Retryable provider failures are attempted three times by default; `error` is sanitized.

```bash
curl http://localhost:3000/jobs/3797131f-c2cb-4e7d-b670-62fef911c141
```

```json
{
  "id": "3797131f-c2cb-4e7d-b670-62fef911c141",
  "document_id": "51ca0f12-2ca7-4bce-a7f2-daf768b17eef",
  "status": "completed",
  "attempt_count": 1,
  "max_attempts": 3,
  "error": null,
  "created_at": "2026-08-26T12:00:00.000Z",
  "updated_at": "2026-08-26T12:00:01.000Z"
}
```

### `POST /chat`

Omit `session_id` to create a session or supply a returned identifier to continue it. Retrieval searches all ready documents in the shared corpus.

```bash
curl -X POST http://localhost:3000/chat \
  -H 'content-type: application/json' \
  -d '{"question":"At which company and during what period did Asya Genç work as a Software Engineering Intern?"}'
```

```json
{
  "session_id": "0dd08806-8bf8-463a-9d0b-e6cc388f2593",
  "answer": "Asya Genç worked as a Software Engineering Intern at SabancıDx in Summer 2025 [1].",
  "sources": [
    {
      "chunk_id": "d57f2e69-d60a-5b01-a871-c53ada3182da",
      "document_id": "51ca0f12-2ca7-4bce-a7f2-daf768b17eef",
      "filename": "asya-genc-cv.json",
      "rank": 1,
      "similarity": 0.84,
      "locator": { "format": "json", "json_path": "$.experience[0]" },
      "excerpt": "{\"title\":\"Software Engineering Intern\",\"company\":\"SabancıDx\",\"dates\":\"Summer 2025\",\"url\":\"\"}"
    }
  ]
}
```

Locators use pages for PDF, paragraph ranges and headings for DOCX, row ranges for CSV, and JSON paths for JSON. Sources always reference persisted retrieved chunks; clients do not need to parse citation markers from generated prose.

### `GET /sessions`

```bash
curl http://localhost:3000/sessions
```

```json
{
  "sessions": [
    {
      "id": "0dd08806-8bf8-463a-9d0b-e6cc388f2593",
      "created_at": "2026-08-26T12:00:00.000Z",
      "updated_at": "2026-08-26T12:02:00.000Z",
      "message_count": 4
    }
  ]
}
```

### `GET /sessions/{id}`

```bash
curl http://localhost:3000/sessions/0dd08806-8bf8-463a-9d0b-e6cc388f2593
```

The response contains `id`, `created_at`, `updated_at`, and an ordered `messages` array. Every message contains `id`, `role`, `content`, `created_at`, and `sources`; user-message sources are empty.

### Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "question", "message": "Too small: expected string to have >=1 characters" }],
    "request_id": "26e726f0-a87a-45cb-91c7-46d102e2d147"
  }
}
```

`details` is present only when safe validation detail is useful. Provider payloads, prompts, database messages, stack traces, and document content are not returned.

## Conceptual Data Model

The implemented schema is defined in `src/infrastructure/db/schema.ts` and created by the versioned SQL migration under `drizzle/`.

```mermaid
erDiagram
    DOCUMENT ||--o{ DOCUMENT_VERSION : has
    DOCUMENT_VERSION ||--o{ CHUNK : contains
    DOCUMENT_VERSION ||--o{ INGESTION_JOB : processed_by
    SESSION ||--o{ MESSAGE : contains
    MESSAGE ||--o{ MESSAGE_SOURCE : cites
    CHUNK ||--o{ MESSAGE_SOURCE : referenced_by

    DOCUMENT {
        uuid id PK
        string filename
        string media_type
        timestamp created_at
    }
    DOCUMENT_VERSION {
        uuid id PK
        uuid document_id FK
        string status
        string content_hash
    }
    CHUNK {
        uuid id PK
        uuid document_version_id FK
        int ordinal
        text content
        jsonb source_locator
        vector embedding
    }
    INGESTION_JOB {
        uuid id PK
        uuid document_version_id FK
        string status
        int attempt_count
        timestamp available_at
        timestamp locked_at
        text last_error
    }
    SESSION {
        uuid id PK
        timestamp created_at
        timestamp updated_at
    }
    MESSAGE {
        uuid id PK
        uuid session_id FK
        string role
        text content
        timestamp created_at
    }
    MESSAGE_SOURCE {
        uuid message_id FK
        uuid chunk_id FK
        int rank
        float similarity
    }
```

The migration creates explicit document/job/message status enums, foreign keys, uniqueness and range constraints, queue-claim indexes, and the pgvector cosine HNSW index. Source locators are stored as JSONB because each format has different stable location fields. Chunk deletion is restricted once a message cites it, preserving citation integrity.

## Architecture Rationale and Trade-offs

### TypeScript and Node.js

The service is written in TypeScript on Node.js, providing static checking across API contracts, application services, database schemas, and provider integrations.

The implementation pins Node.js 24 LTS, uses npm and ES modules, and enables TypeScript strict mode. TypeScript uses `Bundler` module resolution, allowing extensionless relative imports while preserving standard extensionless package imports.

`npm run build` first runs `tsc --noEmit` so esbuild's transpilation does not replace static type checking. It then creates separate unminified ESM bundles for the API, worker, and migration entry points. Third-party packages remain external, preserving normal Node.js package loading and keeping native or runtime-loaded dependencies out of the bundle.

The bundles include external source maps with embedded TypeScript source content and preserved function/class names. Production commands enable Node's source-map support, so application stack frames refer to the original `.ts` file and line rather than the generated bundle. Source maps are copied into the runtime image but are not exposed through the HTTP API. Production artifact access and server-side stack-trace logging must remain restricted because embedded source content is sensitive implementation data.

Compared with executing `tsc` output directly, esbuild adds a build dependency and makes the emitted bundle less readable without its source map. Its benefits are extensionless source imports, smaller runtime artifacts, fast builds, and accurate TypeScript stack traces. Exact dependency versions are locked in the Docker image and lockfile.

### Express

Express provides the HTTP layer. It has a small conceptual footprint and keeps the service focused on ingestion, retrieval, persistence, and architectural boundaries. Express 5 also forwards rejected promises from asynchronous handlers to error middleware.

Compared with Fastify, Express provides less built-in schema-based validation and serialization. Compared with NestJS, it provides much less framework structure. We accept that trade-off and make validation, application-service boundaries, dependency construction, and error mapping explicit.

### PostgreSQL

PostgreSQL provides:

- Concurrent database access suitable for separate API and worker processes.
- Row-level locking and `SKIP LOCKED` for safe multi-worker job claiming.
- Native integration with pgvector.
- A single transactional boundary for relational data and embeddings.
- A more credible production migration path.

Compared with SQLite, PostgreSQL requires a database service, health checking, credentials, migrations, and a persistent Docker volume. Docker Compose contains that operational overhead behind a single startup command.

### pgvector

Embeddings are stored in PostgreSQL using pgvector. This keeps chunks, source metadata, and embeddings in one transactional data store and allows retrieval results to be filtered and joined using ordinary SQL.

Trade-offs against alternatives:

- **Chroma** is a purpose-built vector database with a TypeScript client, but it would introduce a second persistent service and a dual-write consistency problem between PostgreSQL and Chroma.
- **FAISS** provides high-performance similarity indexes, but it is a library rather than a transactional database. Metadata, persistence, synchronization, and TypeScript integration would become application responsibilities.
- **A dedicated vector service such as Qdrant** is useful when vector search must scale or be operated independently, but that separation is not justified for this workload.

The implementation uses an HNSW index with cosine distance and retrieves the top five chunks. These are configurable defaults rather than quality claims. It uses pgvector's default HNSW tuning parameters and no hard similarity threshold; representative production data should determine tuning.

### Drizzle

Drizzle provides type-safe TypeScript database access, schema definitions, and migrations. It remains close to SQL, supports pgvector column types and indexes directly, and allows explicit control over transactional job-claiming queries.

Prisma offers an approachable generated client and schema language, but introduces a larger abstraction and generation step. Direct visibility into PostgreSQL, pgvector, and queue-locking behavior is more valuable for this service.

Drizzle still requires some database-specific SQL. The migration explicitly enables pgvector, and job claiming uses an explicit locking query. PostgreSQL-specific behavior remains visible rather than being hidden behind the ORM.

### node-postgres

Drizzle connects to PostgreSQL through `node-postgres` (`pg`). Its explicit pool and checked-out-client APIs fit the service's need to control transaction boundaries for job claiming, chunk/vector insertion, and chat-history persistence.

`postgres.js` offers a concise API, but `node-postgres` keeps connection-pool and transaction ownership visible in the infrastructure layer. Code that begins a transaction executes every statement through the same checked-out client and releases that client in a `finally` block. Pool sizing and acquisition, statement, and idle timeouts are environment-configurable; Compose makes migration startup ordering explicit.

### PostgreSQL-Backed Job Queue

The system uses an `ingestion_jobs` table rather than Redis, RabbitMQ, Kafka, or a hosted queue. Workers claim work with `FOR UPDATE SKIP LOCKED`, and document/job state changes remain visible in the same database.

This design minimizes infrastructure and provides durable jobs, but requires polling, retry/lease implementation, cleanup, and care to prevent queue traffic from competing with application traffic. A production system may move to a dedicated queue when throughput, delayed delivery, prioritization, or operational isolation justifies it.

The worker runs as a separate Docker Compose service using the same application image as the API. This preserves a real asynchronous process boundary while keeping startup to one command. A dedicated broker is unnecessary at the current scale.

### Configurable Format-Aware Chunking

The implementation uses conservative, replaceable defaults:

- Target approximately 800 tokens with 100 tokens of overlap.
- Prefer heading, paragraph, row, and object boundaries over cutting at the exact target.
- Preserve page metadata for PDF and heading/paragraph structure for DOCX.
- Represent each CSV row with its column names; split only exceptionally large rows.
- Represent JSON objects or array elements with their JSON paths; recursively split oversized values.
- Derive deterministic chunk identity from the document version, ordinal, and normalized-content hash.

The overlap reduces the chance that an answer-bearing sentence is separated from its context. The 800-token target is small enough for precise citations while avoiding excessive embedding requests. Size and overlap are configuration-backed and require evaluation against representative data.

The splitter uses a deterministic estimate of four normalized characters per token rather than coupling chunking to one provider's tokenizer. PDF pages and JSON paths remain independent citation units; DOCX paragraphs and CSV rows may be grouped into ranges before oversized content is split at paragraph, sentence, or word boundaries. This approximation is simple and provider-neutral, but less exact than model-specific tokenization and requires retrieval evaluation.

### Configurable Embedding Provider

OpenAI is the default provider, using `text-embedding-3-small` with 1,536 dimensions. Embedding requests are usually the highest-volume model operation in ingestion and retrieval, so the smaller model provides a practical balance of cost, latency, and general-purpose semantic quality. Its widely supported OpenAI embeddings contract also keeps setup straightforward. This default is not a measured claim that it is the best model for legal retrieval; model selection requires evaluation against representative legal questions, documents, citation recall, latency, and cost.

Provider base URL, API key, model name, batch size, timeout, and expected dimensions come from validated environment configuration. The embedding gateway depends on an application interface rather than exposing the OpenAI SDK to application services. This keeps hosted OpenAI and OpenAI-compatible local endpoints behind the same application boundary.

An OpenAI-compatible local endpoint may replace the hosted provider without changing application services. A local model can improve data control and remove per-request provider cost, but adds model hosting, capacity planning, and quality evaluation. Embedding dimensions are also a database concern: the pgvector schema uses the default model's 1,536 dimensions. Switching to a local model with a different dimension requires a schema/index migration and complete document re-index; arbitrary models cannot be mixed in one index. The system persists the embedding provider, model, and dimension with indexed document versions so incompatibility is explicit.

### Configurable Generation Provider

OpenAI is the default provider, using `gpt-5.4-mini` to balance capability, latency, and cost. Provider base URL, API key, and model name are configurable independently from embedding settings. The generation gateway supports an OpenAI-compatible local endpoint and keeps provider-specific request and response formats out of the chat application service.

Local compatibility is configuration-based, not a promise that every local server implements every OpenAI feature. The gateways use Chat Completions plus float embeddings as their small common surface; the deterministic E2E fake exercises both network contracts.

### Parser Libraries

- **PDF:** Mozilla PDF.js through `pdfjs-dist` for native page-level extraction. Pages containing raster images with fewer than 100 non-whitespace native characters fall back to Poppler rendering and local Tesseract OCR. OCR output replaces native text only when it recovers more content, and citations remain page-based.
- **DOCX:** Mammoth provides established semantic DOCX-to-HTML extraction. DOCX page numbers are not stable, so citations use headings and paragraph positions.
- **CSV:** `csv-parse` provides a server-side Node streaming API, strong package adoption, and a better fit for backend ingestion than Papa Parse, despite Papa Parse having more GitHub stars.
- **JSON:** the built-in `JSON.parse`, followed by application validation and traversal; an external parser is unnecessary for the current non-streaming JSON workflow.

Library selection weighs popularity alongside maintenance activity, server-side suitability, TypeScript usability, streaming behavior, and the required citation metadata. Exact dependency versions are pinned in `package-lock.json`.

Selective OCR closes an important PDF edge case: a visually text-heavy PDF may store its main page as an image while exposing only a few overlay labels in its text layer. Running OCR only on suspicious image-bearing pages avoids the cost on normal digital PDFs. Poppler and Tesseract increase the application image size and ingestion latency, but keep legal document pages local rather than introducing another external processor. OCR enablement, native-text threshold, DPI, language, and timeout are configurable.

### Shared Docker Volume for Documents

The API writes accepted uploads to a named Docker volume mounted into both API and worker services. PostgreSQL stores document metadata and processing state, not the original file bytes. This keeps local operation simple and avoids bloating the relational database.

The trade-off is that a Docker volume is a single-host storage mechanism. A production deployment would replace the filesystem adapter with durable object storage while keeping the ingestion application interface unchanged.

### Global Document Corpus and Minimal Session API

The service has one shared knowledge corpus. Every chat searches all successfully indexed (`ready`) document versions; clients do not select documents, collections, workspaces, or tenants. This minimizes the API, but it is not an acceptable production authorization model.

There is no session-creation endpoint. `POST /chat` accepts an optional `session_id`: omitting it creates and returns a new session, while supplying it continues an existing session. `GET /sessions` exposes session discovery without adding a separate lifecycle API. The complete API contains five endpoints.

### Deterministic Follow-up Context

History-aware retrieval supports follow-up questions such as “What did she do there?”. For a continuing session, the retrieval text contains the latest persisted user message, the latest assistant response, and the current user question with explicit labels. Only this most recent exchange is used for retrieval, while the generation model still receives the configured conversation-history window. First-turn retrieval uses the question unchanged.

This approach adds no extra model request, remains provider-neutral, and is deterministic enough to verify at the unit and end-to-end boundaries. Limiting retrieval context to one exchange also reduces topic pollution and embedding input growth compared with embedding the full conversation.

The trade-off is that deterministic concatenation does not actually resolve pronouns and may carry an inaccurate earlier answer into retrieval. It can also bias a genuine topic change toward the previous subject. Follow-up detection and LLM-based standalone-question rewriting require evaluation against representative conversations before accepting their additional latency, cost, and failure modes. Concatenation keeps the behavior small and deterministic.

### Design Patterns

The implementation uses patterns only where they clarify a real boundary:

- **Repository:** PostgreSQL repositories implement application-facing persistence interfaces. Application workflows can express document, queue, chat, and retrieval operations without depending on Drizzle queries, while infrastructure tests remain separate from service unit tests.
- **Strategy:** PDF, DOCX, CSV, and JSON parsers implement one `DocumentParser` contract. Each format can preserve its own source-location semantics without conditional parsing logic spreading into the worker.
- **Registry:** `DefaultParserRegistry` maps a validated media type to the corresponding parser strategy. Selection has one explicit location, and adding a format does not alter the ingestion workflow.
- **Gateway/Adapter:** embedding and generation gateways translate the provider's OpenAI-compatible protocol into small application interfaces. Provider configuration and errors do not leak into chat or ingestion services.
- **Dependency Injection:** `bootstrap()` explicitly constructs and passes repositories, gateways, storage, clocks, and identifier functions. This makes dependencies visible and replaceable in unit tests without introducing a runtime container.

These patterns isolate behavior that genuinely varies: persistence, document format, and model provider. A dependency-injection container and generic base-repository hierarchy would add indirection without reducing the service's complexity.

## Validation and Error Handling

The implemented policy is:

- Validate environment configuration at startup.
- Validate path parameters and JSON/multipart input at the HTTP boundary.
- Reject unsupported media types and files above an approved limit.
- Use application-specific error types and one centralized HTTP error mapper.
- Do not expose stack traces, provider payloads, prompts, document contents, or database details to clients.
- Distinguish permanent ingestion failures from retryable provider/network failures.
- Record enough failure context for operators while sanitizing API responses.

Zod validates environment configuration and HTTP input. API errors use one stable envelope containing a machine-readable `code`, safe `message`, optional validation `details`, and request identifier. The upload limit and dependency timeouts are conservative, environment-configurable defaults rather than hard-coded architectural constraints.

## Testing Strategy

Vitest is the TypeScript test runner. Unit tests are fast, deterministic, and runnable without Docker, PostgreSQL, the filesystem, network access, or API credentials. End-to-end tests exercise the deployed topology rather than replacing infrastructure with mocks.

### Test Layout and Naming

Unit tests live under the root `test/` directory and mirror the path under `src/` exactly. Production source files do not contain colocated test files.

```text
src/application/chat-service.ts  -> test/application/chat-service.spec.ts
src/config/env.ts                -> test/config/env.spec.ts
src/parsers/json-parser.ts       -> test/parsers/json-parser.spec.ts
src/parsers/pdf-parser.ts        -> test/parsers/pdf-parser.spec.ts

test/e2e/                        end-to-end specifications
test/fake-ai/                    deterministic OpenAI-compatible fake
```

The mirrored path makes ownership obvious and allows direct navigation between a module and its unit specification. End-to-end files use the suffix `.e2e.spec.ts` so Vitest projects can select them independently.

### Unit-Test Contract

A unit specification tests one production module. Every direct dependency that crosses that module's boundary is replaced with a mock, stub, or small in-memory fake. Examples include repositories, clocks, identifier generators, filesystem access, parser libraries, embedding/generation gateways, and loggers.

Unit tests:

- Exercise public behavior, outputs, state transitions, and meaningful collaborator interactions.
- Inject dependencies through explicit interfaces where practical.
- Use typed `vi.fn()`/`vi.mock()` mocks and reset them between tests.
- Control time, identifiers, randomness, and provider responses when they affect behavior.
- Cover success, boundary, and failure paths that contain real branching logic.
- Avoid a database, containers, network calls, actual model APIs, and persistent files.

Pragmatism takes precedence over mock purity:

- Pure helper functions and inert value objects do not need to be mocked.
- Tests should not mock a module's private implementation or transitive dependencies.
- Do not assert every internal call or duplicate TypeScript's type checking.
- If mocking removes the behavior that matters, the scenario belongs in an integration or end-to-end test.
- Third-party parser behavior is verified with real fixtures at the end-to-end boundary; unit tests for our parser adapters focus on normalization, error translation, and source-location mapping.

### End-to-End Contract

End-to-end tests start the same API, worker, PostgreSQL/pgvector, migrations, and shared upload volume used by the local Docker Compose setup. Tests communicate through public HTTP endpoints and observe asynchronous work by polling `GET /jobs/{id}` with a bounded timeout.

The test profile uses a deterministic OpenAI-compatible fake service for embeddings and generation. This avoids cost, credentials, rate limits, and nondeterministic model text while retaining the real provider adapter and network boundary. Live OpenAI calls are not required for automated verification.

The main end-to-end scenarios are:

1. Upload the repository's representative PDF, DOCX, and JSON files plus a minimal CSV; observe `202`, a queued/running job, and eventual completion.
2. Ask one deterministic grounded question per repository file; verify explicit answer facts and the expected filename/locator are returned.
3. Start a grounded JSON conversation, then ask the ambiguous follow-up “What did she do there?”; verify retrieval still returns the relevant JSON source.
4. Retrieve the continued session and verify its persisted ordered history and sources.
5. List session summaries; verify the most recently active session and its message count.
6. Reject an unsupported or malformed upload with the documented error envelope.
7. Simulate a provider/parser failure and verify retry/final failed-job behavior without exposing internal error details.

Assertions target stable behavior and persisted relationships, not exact natural-language wording. The end-to-end environment starts from isolated database and upload volumes, then removes them, so runs do not depend on previous state.

The grounded fixture cases are declared together in `test/e2e/core.e2e.spec.ts`, including the question, human-readable expected answer, stable answer fragments, filename, and source locator:

| Repository fixture | Question | Expected facts |
| --- | --- | --- |
| `test/files/selcukcihan.pdf` | What software did Selçuk create while working at Serverless Inc.? | Python AWS Lambda SDK; Serverless Console; PDF page 1 |
| `test/files/docx-test.docx` | Where should figure captions and descriptions be placed in the CMS user manual template? | Left-aligned; below the figure; alternative text; DOCX source |
| `test/files/asya-genc-cv.json` | At which company and during what period did Asya Genç work as a Software Engineering Intern? | SabancıDx; Summer 2025; `$.experience[0]` |

The CSV is a small in-memory ingestion smoke fixture because no CSV file is present under `test/files/`. Error-path inputs are synthetic so their malformed or provider-failure behavior is obvious and intentional.

### Test Commands

The package scripts are:

```bash
npm test                  # unit tests once; no Docker required
npm run test:watch        # unit tests in watch mode
npm run test:coverage     # unit tests with V8 coverage
npm run build             # typecheck and create source-mapped esbuild bundles
npm run test:e2e          # build and run the isolated Compose test profile
npm run test:all          # unit tests followed by end-to-end tests
```

`npm test` remains the shortest and fastest developer feedback loop. Coverage is a diagnostic tool, not a target for meaningless tests; the project imposes no blanket 100% threshold. Critical orchestration, queue-state, retrieval, citation, and error-handling branches are nevertheless covered deliberately.

## Local Setup

### Prerequisites

- Docker with Docker Compose.
- An OpenAI API key, unless using compatible local embedding and generation endpoints.

### Start the service

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`, then run:

```bash
docker compose up --build
```

The API listens on `http://localhost:3000`. Compose waits for PostgreSQL, runs the Drizzle migration as a one-shot service, and starts API and worker only after migration success. The application image includes Poppler and English Tesseract data for selective PDF OCR; no host installation of Node.js, PostgreSQL, pgvector, OCR, or parser tools is required. Using another `PDF_OCR_LANGUAGE` also requires adding its Tesseract language package to the runtime image.

To stop while preserving ingested data:

```bash
docker compose down
```

To deliberately remove the local database and uploaded files as well:

```bash
docker compose down --volumes
```

The second command is destructive to the Compose-managed local data volumes.

The local topology is:

```text
api       application image, Express entry point, shared upload volume
worker    same application image, worker entry point, shared upload volume
postgres  version-pinned pgvector PostgreSQL image, database volume
```

Compose starts the API, worker, and PostgreSQL automatically. It includes a PostgreSQL health check, separate persistent database and upload volumes, migration ordering, graceful shutdown, and restart-safe lease recovery. Image versions are pinned rather than relying on `latest`. A local model server is optional rather than part of the default stack, avoiding a large model download when using an OpenAI API key.

The end-to-end command activates an isolated Compose test profile that adds the deterministic AI fake and test runner, waits on service health checks, returns the test runner's exit code, and removes its isolated volumes afterward. Individual services do not require manual setup or cleanup.

`.env.example` documents the database URL, upload path, PDF OCR controls, independent embedding and generation base URLs/API keys/model names, embedding dimensions, server port, log level, retrieval limit, and worker polling/retry settings. Hosted OpenAI is the default. To use local compatible servers, set the two base URLs and model names independently and provide any non-empty key value required by those servers.

## Production Considerations

### Scalability

- Run stateless API replicas separately from horizontally scaled workers.
- Move uploaded documents to durable object storage rather than container-local disk.
- Add database connection pooling and tune PostgreSQL for API, queue, and vector workloads.
- Benchmark exact search against HNSW/IVFFlat using representative corpus size, filters, latency targets, and recall measurements.
- Partition or isolate tenant data and vector indexes if tenant filtering affects recall or performance.
- Consider a dedicated queue when database polling or job volume becomes material.
- Consider a dedicated vector platform only when independent scaling or operational ownership outweighs cross-store complexity.

### Security

- Add authentication, authorization, tenant isolation, and document-level access control.
- Encrypt traffic and persistent data; use a secrets manager and short-lived credentials.
- Apply strict file-size/type checks, malware scanning, archive-bomb defenses, and parser sandboxing.
- Apply OCR page, pixel, CPU, memory, and execution-time limits; isolate native parser and OCR processes from sensitive host resources.
- Treat retrieved text as untrusted input and defend against prompt injection and data exfiltration.
- Apply retention/deletion policies suitable for legal documents and verify cascading deletion of embeddings, citations, and stored files.
- Maintain audit logs for document access, ingestion, retrieval, and administrative operations without logging sensitive document content.
- Review provider data-processing and retention policies before sending legal content to external models.

### Monitoring and Observability

- Emit structured logs with request, session, document, and job correlation identifiers.
- Track API latency/error rates, queue depth and job age, retries/failures, parsing and embedding duration, token consumption, retrieval latency, result scores, and model latency.
- Add distributed traces across API, worker, PostgreSQL, and model-provider calls.
- Alert on growing queue age, repeated ingestion failures, provider errors, database saturation, and abnormal token usage.
- Add readiness/liveness probes and verify migrations and pgvector availability at startup.

### Cost Optimization

- Batch embedding calls and avoid recomputing embeddings using normalized-content hashes.
- Select model sizes based on measured retrieval and answer quality rather than defaulting to the largest model.
- Bound chunk count, retrieved context, conversation history, and generated output.
- Cache immutable embeddings where it provides measurable benefit.
- Use lifecycle policies for original files and superseded document versions.
- Measure vector-index memory/storage overhead before choosing HNSW parameters or a dedicated vector service.

## Runtime Defaults

Operational values are configurable and should be adjusted using representative workload data.

| Area | Default |
| --- | --- |
| Runtime | Node.js 24 LTS, npm, ES modules, strict TypeScript, esbuild bundles with TypeScript source maps |
| Database startup | A one-shot Compose migration service runs Drizzle migrations before API and worker services become ready |
| Connection pools | Separate API and worker pools; conservative limits and timeouts controlled through environment variables |
| Validation | Zod for environment and HTTP boundaries; centralized safe error envelope |
| Unit tests | Vitest; root `test/` mirrors `src/`; direct dependencies mocked; no Docker or external I/O |
| End-to-end tests | Vitest runner against an isolated Docker Compose stack with real PostgreSQL/pgvector, API, worker, volumes, and deterministic fake AI service |
| Coverage | V8 coverage as a diagnostic; meaningful critical-path coverage without a blanket 100% target |
| Structure | Explicit `api`, `application`, `domain`, `infrastructure`, `parsers`, `worker`, and `config` modules; no dependency-injection framework |

Changes that alter API behavior, persistence compatibility, or component ownership should be recorded alongside the relevant architecture rationale.

## References

- [PostgreSQL documentation](https://www.postgresql.org/docs/)
- [pgvector](https://github.com/pgvector/pgvector)
- [Drizzle pgvector support](https://orm.drizzle.team/docs/extensions)
- [node-postgres](https://node-postgres.com/)
- [Express 5 documentation](https://expressjs.com/en/5x/api.html)
- [esbuild](https://esbuild.github.io/)
- [OpenAI Chat Completions API](https://developers.openai.com/api/reference/cli/resources/chat/subresources/completions)
- [OpenAI embeddings](https://developers.openai.com/api/reference/typescript/resources/embeddings/methods/create)
- [OpenAI `text-embedding-3-small`](https://developers.openai.com/api/docs/models/text-embedding-3-small)
- [OpenAI GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [Mozilla PDF.js](https://github.com/mozilla/pdf.js)
- [Poppler](https://poppler.freedesktop.org/)
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)
- [Mammoth](https://github.com/mwilliamson/mammoth.js)
- [Node CSV](https://github.com/adaltas/node-csv)
- [Vitest](https://vitest.dev/)
- [Vitest mocking](https://vitest.dev/guide/mocking.html)
- [Docker Compose service health and dependency conditions](https://docs.docker.com/reference/compose-file/services/)
