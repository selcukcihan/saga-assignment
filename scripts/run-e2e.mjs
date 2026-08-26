import { spawnSync } from "node:child_process";

const files = ["-f", "compose.yaml", "-f", "compose.e2e.yaml"];
const project = ["--project-name", "saga-assignment-e2e"];
const compose = ["compose", ...files, ...project];

const result = spawnSync(
  "docker",
  [...compose, "--profile", "e2e", "up", "--build", "--abort-on-container-exit", "--exit-code-from", "test-runner", "test-runner"],
  { stdio: "inherit" },
);
spawnSync("docker", [...compose, "--profile", "e2e", "down", "--volumes", "--remove-orphans"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
