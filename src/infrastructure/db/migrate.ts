import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadDatabaseConfig } from "../../config/env.js";
import { createDatabase } from "./client.js";

const database = createDatabase(loadDatabaseConfig());

try {
  await migrate(database.db, { migrationsFolder: "drizzle" });
} finally {
  await database.close();
}
