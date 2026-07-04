import "@/lib/load-env";
import { createDb } from "@/db/client";

/**
 * Apply pending Drizzle migrations to the remote Turso (production) database.
 * The app deliberately does NOT migrate on every cold serverless start (that
 * adds slow cross-network round-trips), so run this after generating a new
 * migration and before/at deploy:
 *
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:migrate:prod
 */

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error(
      "TURSO_DATABASE_URL not set. Run with:\n" +
        "  TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:migrate:prod",
    );
    process.exit(1);
  }
  console.log(`Migrating ${process.env.TURSO_DATABASE_URL} …`);
  await createDb(undefined, { migrate: true });
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
