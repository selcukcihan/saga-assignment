import { readFile } from "node:fs/promises";
import JSZip from "jszip";
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

async function docxFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.folder("_rels")!.file(
    ".rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.folder("word")!.file(
    "document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Saga DOCX handbook</w:t></w:r></w:p><w:p><w:r><w:t>The review workflow uses artificial intelligence to organize legal knowledge.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe.sequential("core API", () => {
  let sessionId: string;

  it("asynchronously ingests PDF, DOCX, CSV, and JSON", async () => {
    const fixtures: Array<[string, FixtureContent, string]> = [
      ["assignment.pdf", new Uint8Array(await readFile("assignment.pdf")), "application/pdf"],
      ["handbook.docx", await docxFixture(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["people.csv", "name,role\nAda,Engineer\nGrace,Lead\n", "text/csv"],
      ["facts.json", JSON.stringify({ company: "Saga Legal", product: "AI legal technology" }), "application/json"],
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

  it("extracts useful text from the image-backed assignment PDF through OCR", async () => {
    const response = await fetch(`${api}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Which document formats must the core API support?" }),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as {
      answer: string;
      sources: Array<{ filename: string; locator: { format: string; page?: number } }>;
    };
    expect(result.answer).toMatch(/PDF/i);
    expect(result.answer).toMatch(/DOCX/i);
    expect(result.answer).toMatch(/CSV/i);
    expect(result.answer).toMatch(/JSON/i);
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ filename: "assignment.pdf", locator: expect.objectContaining({ format: "pdf", page: 1 }) }),
    ]));
  });

  it("answers with chunk-backed sources and persists a continuing session", async () => {
    const firstResponse = await fetch(`${api}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What does Saga Legal build?" }),
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
      body: JSON.stringify({ question: "What formats can it ingest?", session_id: sessionId }),
    });
    expect(followUp.status).toBe(200);
    await followUp.body?.cancel();

    const historyResponse = await fetch(`${api}/sessions/${sessionId}`);
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json() as { messages: Array<{ role: string; sources: unknown[] }> };
    expect(history.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(history.messages[1]?.sources.length).toBeGreaterThan(0);
    expect(history.messages[3]?.sources.length).toBeGreaterThan(0);
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
