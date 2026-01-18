import type { Kysely } from "kysely";

type MigrationDb = Record<string, unknown>;

export async function up(db: Kysely<MigrationDb>): Promise<void> {
    await db.schema
        .alterTable("sources")
        .addColumn("require_code_snippets", "integer", (col) => col.defaultTo(1))
        .execute();
}

export async function down(db: Kysely<MigrationDb>): Promise<void> {
    await db.schema
        .alterTable("sources")
        .dropColumn("require_code_snippets")
        .execute();
}
