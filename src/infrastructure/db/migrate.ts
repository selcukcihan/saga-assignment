import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadDatabaseConfig } from "../../config/env";
import { createDatabase } from "./client";

const database = createDatabase(loadDatabaseConfig());

try {
  await migrate(database.db, { migrationsFolder: "drizzle" });
} finally {
  await database.close();
}
