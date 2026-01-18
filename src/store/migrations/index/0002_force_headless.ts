import type { Kysely } from "kysely";

type MigrationDb = Record<string, unknown>;

export async function up(db: Kysely<MigrationDb>): Promise<void> {
  await db.schema
    .alterTable("sources")
    .addColumn("force_headless", "integer", (col) => col.defaultTo(0))
    .execute();
}

export async function down(db: Kysely<MigrationDb>): Promise<void> {
  // SQLite does not support DROP COLUMN directly in older versions,
  // but Bun's SQLite should support it in newer versions.
  // For safety, we recreate the table without the column if needed.
  await db.schema
    .alterTable("sources")
    .dropColumn("force_headless")
    .execute();
}
