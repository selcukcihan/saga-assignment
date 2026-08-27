import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import type { FileStore } from "../../application/ports";

export class NodeFileStore implements FileStore {
  async hash(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(path);
      stream.on("error", reject);
      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  async remove(path: string): Promise<void> {
    await rm(path, { force: true });
  }

  async read(path: string): Promise<Uint8Array> {
    return readFile(path);
  }
}
