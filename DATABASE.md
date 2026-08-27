# Database Inspection Guide

The application stores relational data and vector embeddings in the same PostgreSQL database. The pgvector extension adds the `vector(1536)` type, cosine-distance operators, and an HNSW index used for semantic retrieval.

This guide uses read-only queries unless stated otherwise.

## Connect with `psql`

Start the stack if it is not already running:

```bash
docker compose up -d --build
```

Open PostgreSQL's interactive shell inside the running container:

```bash
docker compose exec postgres psql -U saga -d saga
```

The Compose database credentials are:

| Setting | Value |
| --- | --- |
| Database | `saga` |
| User | `saga` |
| Password | `saga` |
| Container hostname | `postgres` |
| Container port | `5432` |

PostgreSQL is not published on a host port. Connecting through `docker compose exec` requires no host PostgreSQL installation and avoids exposing the database outside the Compose network.

Inside `psql`, disable the pager and use expanded output automatically when rows are wide:

```sql
\pset pager off
\x auto
```

Verify the connection and pgvector extension:

```sql
SELECT current_database(), current_user;

SELECT extname, extversion
FROM pg_extension
WHERE extname = 'vector';
```

## Explore the Schema

List the application tables:

```sql
\dt
```

The tables have the following responsibilities:

| Table | Stored data |
| --- | --- |
| `documents` | Original filename, media type, and shared-volume storage path |
| `document_versions` | Processing state, content hash, and embedding model metadata |
| `chunks` | Extracted text, source locator, content hash, and pgvector embedding |
| `ingestion_jobs` | Durable asynchronous job state, leases, retries, and failures |
| `sessions` | Conversation identity and activity timestamps |
| `messages` | Persisted user questions and assistant answers |
| `message_sources` | Ranked links from assistant answers to retrieved chunks |

Inspect the vector table:

```sql
\d+ chunks
```

Inspect its indexes:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'chunks';
```

The result includes `chunks_embedding_hnsw_idx`, an HNSW index configured with `vector_cosine_ops`.

## Inspect Ingested Documents

List documents, processing status, embedding configuration, and chunk counts:

```sql
SELECT
    d.id AS document_id,
    d.filename,
    d.media_type,
    v.id AS version_id,
    v.status,
    v.embedding_provider,
    v.embedding_model,
    v.embedding_dimensions,
    (
        SELECT count(*)
        FROM chunks c
        WHERE c.document_version_id = v.id
    ) AS chunk_count
FROM documents d
JOIN document_versions v ON v.document_id = d.id
ORDER BY d.created_at DESC;
```

Original file bytes are not stored in PostgreSQL. They live in the shared Docker upload volume. PostgreSQL stores file metadata, processing state, extracted chunks, source locations, and embeddings.

## Inspect Extracted Chunks

Display chunk content and format-specific source locations without printing the full embedding:

```sql
SELECT
    d.filename,
    c.ordinal,
    jsonb_pretty(c.source_locator) AS source,
    left(c.content, 400) AS content,
    vector_dims(c.embedding) AS dimensions
FROM chunks c
JOIN document_versions v ON v.id = c.document_version_id
JOIN documents d ON d.id = v.document_id
ORDER BY d.filename, c.ordinal;
```

Source locators preserve the location from which each chunk was extracted. Examples include:

- PDF page numbers.
- DOCX headings and paragraph ranges.
- CSV row ranges.
- JSON paths such as `$.experience[0]`.

Preview a stored embedding without printing all 1,536 values:

```sql
SELECT
    id,
    left(embedding::text, 250) || '...' AS embedding_preview
FROM chunks
LIMIT 5;
```

An embedding is a large array of floating-point numbers. The human-readable information associated with it is stored in `content` and `source_locator`.

## Run a Vector Similarity Query

The following query uses the first stored chunk as an anchor vector and returns its nearest chunks:

```sql
WITH anchor AS (
    SELECT id, embedding
    FROM chunks
    ORDER BY created_at, ordinal
    LIMIT 1
)
SELECT
    c.id,
    c.id = a.id AS is_anchor,
    d.filename,
    c.ordinal,
    round((1 - (c.embedding <=> a.embedding))::numeric, 4) AS cosine_similarity,
    left(c.content, 160) AS content
FROM chunks c
CROSS JOIN anchor a
JOIN document_versions v ON v.id = c.document_version_id
JOIN documents d ON d.id = v.document_id
WHERE v.status = 'ready'
ORDER BY c.embedding <=> a.embedding
LIMIT 10;
```

The anchor chunk has a cosine similarity of `1.0000`. Semantically related chunks should generally have higher scores than unrelated chunks. Ingest more than one document to make the comparison more informative.

The application performs the same type of search with an embedding generated from the user's question:

```sql
1 - (chunk_embedding <=> query_embedding)
```

The `<=>` operator returns cosine distance. Subtracting it from `1` converts the result to cosine similarity, where larger values indicate greater similarity.

## Inspect Ingestion Jobs

Display job state, attempts, leases, and sanitized failure details:

```sql
SELECT
    j.id,
    d.filename,
    j.status,
    j.attempt_count,
    j.max_attempts,
    j.available_at,
    j.locked_at,
    j.locked_by,
    j.last_error
FROM ingestion_jobs j
JOIN document_versions v ON v.id = j.document_version_id
JOIN documents d ON d.id = v.document_id
ORDER BY j.created_at DESC;
```

Normal completed jobs have `status = 'completed'`. A job being processed has a worker identifier and lease timestamp in `locked_by` and `locked_at`.

## Inspect Conversations

List persisted user questions and assistant answers:

```sql
SELECT
    m.session_id,
    m.role,
    m.content,
    m.created_at
FROM messages m
ORDER BY m.session_id, m.created_at;
```

List sessions with message counts:

```sql
SELECT
    s.id,
    s.created_at,
    s.updated_at,
    count(m.id) AS message_count
FROM sessions s
LEFT JOIN messages m ON m.session_id = s.id
GROUP BY s.id, s.created_at, s.updated_at
ORDER BY s.updated_at DESC;
```

## Inspect Answer Citations

Each `message_sources` row records which retrieved chunk supported an assistant answer, along with its retrieval rank and similarity score:

```sql
SELECT
    m.session_id,
    left(m.content, 120) AS answer,
    ms.rank,
    round(ms.similarity::numeric, 4) AS similarity,
    d.filename,
    c.ordinal,
    jsonb_pretty(c.source_locator) AS source,
    left(c.content, 240) AS cited_chunk
FROM message_sources ms
JOIN messages m ON m.id = ms.message_id
JOIN chunks c ON c.id = ms.chunk_id
JOIN document_versions v ON v.id = c.document_version_id
JOIN documents d ON d.id = v.document_id
ORDER BY m.created_at, ms.rank;
```

This query connects the complete retrieval chain:

```text
assistant message -> message_sources -> chunk -> document version -> document
```

## Run Queries Without Opening an Interactive Shell

Pass a query directly to `psql` with `-c`:

```bash
docker compose exec -T postgres psql -U saga -d saga -c \
  "SELECT filename, media_type, created_at FROM documents ORDER BY created_at DESC;"
```

This form is convenient for scripts and quick checks. The `-T` flag disables pseudo-terminal allocation.

## Exit

Leave the interactive `psql` session with:

```sql
\q
```

The schema is defined in [`src/infrastructure/db/schema.ts`](src/infrastructure/db/schema.ts), and the application vector-search query is implemented in [`src/infrastructure/repositories/postgres-chat-repository.ts`](src/infrastructure/repositories/postgres-chat-repository.ts).
