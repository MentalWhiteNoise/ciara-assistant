import { defineConfig } from "drizzle-kit";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");

export default defineConfig({
  // Where our schema files are
  schema: "./src/db/schema/index.ts",
  // Where to output generated migration SQL files
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: path.join(DATA_DIR, "ciara.db"),
  },
  // Verbose output when generating migrations
  verbose: true,
  strict: true,
});
