import { database, migrateDatabase } from "../lib/database.ts";

try {
  await migrateDatabase();
  console.log("Database schema is current.");
} finally {
  database.close();
}
