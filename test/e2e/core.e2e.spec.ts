import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const api = process.env["API_BASE_URL"] ?? "http://127.0.0.1:3000";

interface IngestResponse {
  document_id: string;
  job_id: string;
  status: "queued";
}

interface JobResponse {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  attempt_count: number;
  error: string | null;
}

type FixtureContent = string | Uint8Array;

interface KnowledgeFixture {
  path: string;
  filename: string;
  mediaType: string;
  question: string;
  expectedAnswer: string;
  expectedAnswerFragments: string[];
  expectedLocator: Record<string, string | number>;
}

const knowledgeFixtures: KnowledgeFixture[] = [
  {
    path: "test/files/selcukcihan.pdf",
    filename: "selcukcihan.pdf",
    mediaType: "application/pdf",
    question: "What software did Selçuk create while working at Serverless Inc.?",
    expectedAnswer: "He created the Python AWS Lambda SDK for Serverless Console.",
    expectedAnswerFragments: ["Python AWS Lambda SDK", "Serverless Console"],
    expectedLocator: { format: "pdf", page: 1 },
  },
  {
    path: "test/files/docx-test.docx",
    filename: "docx-test.docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    question: "Where should figure captions and descriptions be placed in the CMS user manual template?",
    expectedAnswer: "They should be left-aligned below the figure, with alternative text for Section 508 compliance.",
    expectedAnswerFragments: ["left-aligned", "below", "alternative text"],
    expectedLocator: { format: "docx" },
  },
  {
    path: "test/files/asya-genc-cv.json",
    filename: "asya-genc-cv.json",
    mediaType: "application/json",
    question: "At which company and during what period did Asya Genç work as a Software Engineering Intern?",
    expectedAnswer: "She worked at SabancıDx during Summer 2025.",
    expectedAnswerFragments: ["SabancıDx", "Summer 2025"],
    expectedLocator: { format: "json", json_path: "$.experience[0]" },
  },
];

async function upload(filename: string, content: FixtureContent, mediaType: string): Promise<Response> {
  const form = new FormData();
  const blobContent = typeof content === "string" ? content : copyToArrayBuffer(content);
  form.append("file", new Blob([blobContent], { type: mediaType }), filename);
  return fetch(`${api}/ingest`, { method: "POST", body: form });
}

function copyToArrayBuffer(content: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(content.byteLength);
  new Uint8Array(buffer).set(content);
  return buffer;
}

async function waitForJob(jobId: string, timeoutMs = 30_000): Promise<JobResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${api}/jobs/${jobId}`);
    expect(response.status).toBe(200);
    const job = (await response.json()) as JobResponse;
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

describe.sequential("core API", () => {
  let sessionId: string;

  it("asynchronously ingests PDF, DOCX, CSV, and JSON", async () => {
    const fixtures: Array<[string, FixtureContent, string]> = [
      ...await Promise.all(knowledgeFixtures.map(async (fixture) => [
        fixture.filename,
        new Uint8Array(await readFile(fixture.path)),
        fixture.mediaType,
      ] as [string, FixtureContent, string])),
      ["people.csv", "name,role\nAda,Engineer\nGrace,Lead\n", "text/csv"],
    ];

    for (const [filename, content, mediaType] of fixtures) {
      const response = await upload(filename, content, mediaType);
      expect(response.status).toBe(202);
      const ingestion = (await response.json()) as IngestResponse;
      expect(ingestion).toMatchObject({ status: "queued" });
      expect(ingestion.document_id).toMatch(/^[0-9a-f-]{36}$/);
      await expect(waitForJob(ingestion.job_id)).resolves.toMatchObject({ status: "completed", error: null });
    }
  });

  it.each(knowledgeFixtures)("answers the deterministic question for $filename", async (fixture) => {
    const response = await fetch(`${api}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: fixture.question }),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as {
      answer: string;
      sources: Array<{ filename: string; locator: { format: string; page?: number } }>;
    };
    for (const fragment of fixture.expectedAnswerFragments) {
      expect(fixture.expectedAnswer).toContain(fragment);
      expect(result.answer).toContain(fragment);
    }
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filename: fixture.filename,
        locator: expect.objectContaining(fixture.expectedLocator),
      }),
    ]));
  });

  it("uses the most recent exchange to retrieve context for an ambiguous follow-up", async () => {
    const firstResponse = await fetch(`${api}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: knowledgeFixtures[2]!.question }),
    });
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as { session_id: string; answer: string; sources: Array<{ chunk_id: string; locator: unknown }> };
    sessionId = first.session_id;
    expect(first.answer.length).toBeGreaterThan(0);
    expect(first.sources.length).toBeGreaterThan(0);
    expect(first.sources[0]?.chunk_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.sources[0]?.locator).toBeTypeOf("object");

    const followUp = await fetch(`${api}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What did she do there?", session_id: sessionId }),
    });
    expect(followUp.status).toBe(200);
    const followUpResult = await followUp.json() as {
      answer: string;
      sources: Array<{ filename: string; locator: { format: string; json_path?: string } }>;
    };
    expect(followUpResult.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filename: knowledgeFixtures[2]!.filename,
        locator: expect.objectContaining(knowledgeFixtures[2]!.expectedLocator),
      }),
    ]));

    const historyResponse = await fetch(`${api}/sessions/${sessionId}`);
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json() as { messages: Array<{ role: string; sources: unknown[] }> };
    expect(history.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(history.messages[1]?.sources.length).toBeGreaterThan(0);
    expect(history.messages[3]?.sources.length).toBeGreaterThan(0);
  });

  it("lists session summaries for external inspection", async () => {
    const response = await fetch(`${api}/sessions`);
    expect(response.status).toBe(200);
    const result = await response.json() as {
      sessions: Array<{ id: string; created_at: string; updated_at: string; message_count: number }>;
    };

    expect(result.sessions[0]).toMatchObject({ id: sessionId, message_count: 4 });
    expect(Number.isNaN(Date.parse(result.sessions[0]!.created_at))).toBe(false);
    expect(Number.isNaN(Date.parse(result.sessions[0]!.updated_at))).toBe(false);
  });

  it("returns the documented error envelope for unsupported uploads", async () => {
    const response = await upload("notes.txt", "unsupported", "text/plain");
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_MEDIA_TYPE", request_id: expect.any(String) },
    });
  });

  it("marks malformed documents as failed without leaking parser details", async () => {
    const response = await upload("broken.json", "{", "application/json");
    expect(response.status).toBe(202);
    const ingestion = (await response.json()) as IngestResponse;
    const job = await waitForJob(ingestion.job_id);
    expect(job).toMatchObject({ status: "failed", attempt_count: 1, error: "Malformed JSON document" });
  });

  it("retries provider failures and exposes only a sanitized final error", async () => {
    const response = await upload(
      "provider-failure.json",
      JSON.stringify({ text: "TRIGGER_PROVIDER_FAILURE" }),
      "application/json",
    );
    expect(response.status).toBe(202);
    const ingestion = (await response.json()) as IngestResponse;
    const job = await waitForJob(ingestion.job_id, 45_000);
    expect(job).toMatchObject({ status: "failed", attempt_count: 3, error: "AI provider request failed" });
  });
});
