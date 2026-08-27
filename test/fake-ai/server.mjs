import { createServer } from "node:http";

const dimensions = 1536;
const deterministicAnswers = new Map([
  [
    "At which company and during what period did Asya Genç work as a Software Engineering Intern?",
    "She worked at SabancıDx during Summer 2025 [1].",
  ],
]);

function embed(text) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const words = String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const word of words) {
    let hash = 2166136261;
    for (const character of word) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    vector[Math.abs(hash) % dimensions] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.url === "/health") return json(response, 200, { ok: true });
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};

  if (request.url === "/v1/embeddings" && request.method === "POST") {
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    if (inputs.some((input) => String(input).includes("TRIGGER_PROVIDER_FAILURE"))) {
      return json(response, 503, { error: { message: "Injected provider failure", type: "server_error" } });
    }
    return json(response, 200, {
      object: "list",
      model: body.model,
      data: inputs.map((input, index) => ({ object: "embedding", index, embedding: embed(input) })),
      usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
    });
  }
  if (request.url === "/v1/chat/completions" && request.method === "POST") {
    const system = body.messages?.find((message) => message.role === "system")?.content ?? "";
    const context = system.split("DOCUMENT CONTEXT\n")[1] ?? "";
    const question = body.messages?.findLast((message) => message.role === "user")?.content ?? "";
    const answer = deterministicAnswers.get(question) ?? `${context} [1]`;
    return json(response, 200, {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: body.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }
  return json(response, 404, { error: { message: "Not found" } });
}).listen(8080, "0.0.0.0");
