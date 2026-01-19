import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

import { ensureFileDir, getDefaultDbPath, getCacheDir } from "../core/paths";
import { dirname, join } from "node:path";
import { existsSync, unlinkSync, rmSync } from "node:fs";
import { runIndexMigrations, runLibraryMigrations } from "./migrate";
import { maybeMigrateLegacySingleDb } from "./legacy-migrate";

const DEFAULT_EMBED_DIMENSIONS = 768;

// On macOS, use Homebrew's SQLite which supports extensions
if (process.platform === "darwin") {
  const homebrewSqlitePath = "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
  try {
    if (Bun.file(homebrewSqlitePath).size > 0) {
      Database.setCustomSQLite(homebrewSqlitePath);
    }
  } catch {
    // ignore
  }
}

export type Store = {
  db: Database;
  dbPath: string;
  close: () => void;
  ensureVecTable: (dimensions?: number) => void;
};

export async function createStore(dbPath?: string): Promise<Store> {
  const path = dbPath ?? getDefaultDbPath();
  if (!process.env.LIBRARIAN_LIBRARY_DB_DIR) {
    process.env.LIBRARIAN_LIBRARY_DB_DIR = join(dirname(path), "db");
  }
  ensureFileDir(path);
  const freshMarker = join(getCacheDir(), ".fresh");
  if (existsSync(freshMarker)) {
    rmSync(freshMarker, { force: true });
  } else {
    await maybeMigrateLegacySingleDb(path);
  }
  let db = new Database(path);
  initDatabase(db);
  try {
    await runIndexMigrations(db);
  } catch (error) {
    if (!isRecoverableSqliteError(error)) throw error;
    db.close();
    deleteDbFiles(path);
    db = new Database(path);
    initDatabase(db);
    await runIndexMigrations(db);
  }

  return {
    db,
    dbPath: path,
    close: () => db.close(),
    ensureVecTable: (dimensions?: number) => ensureVecTableInternal(db, dimensions ?? DEFAULT_EMBED_DIMENSIONS),
  };
}

export async function createLibraryStore(dbPath: string): Promise<Store> {
  ensureFileDir(dbPath);
  const db = new Database(dbPath);
  initDatabase(db);
  await runLibraryMigrations(db);
  return {
    db,
    dbPath,
    close: () => db.close(),
    ensureVecTable: (dimensions?: number) => ensureVecTableInternal(db, dimensions ?? DEFAULT_EMBED_DIMENSIONS),
  };
}

function initDatabase(db: Database): void {
  sqliteVec.load(db);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
}

function ensureVecTableInternal(db: Database, dimensions: number): void {
  // Check if table already exists with correct schema
  const tableInfo = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='vectors_vec'`)
    .get() as { sql: string } | null;
  if (tableInfo) {
    const match = tableInfo.sql.match(/float\[(\d+)\]/);
    const hasChunkId = tableInfo.sql.includes("chunk_id");
    const hasCosine = tableInfo.sql.includes("distance_metric=cosine");
    const existingDims = match?.[1] ? Number.parseInt(match[1], 10) : null;
    if (existingDims === dimensions && hasChunkId && hasCosine) return;
    db.exec("DROP TABLE IF EXISTS vectors_vec");
  }

  // Workaround: sqlite-vec extension fails to create shadow tables when WAL file is large.
  // After bulk inserts (e.g., crawling 2000+ pages), the WAL file can grow to tens of MB.
  // Creating a virtual table (vec0) in this state causes "disk I/O error" on shadow table creation.
  // Solution: Temporarily switch to DELETE journal mode, create the table, then switch back to WAL.
  // This forces a full checkpoint and avoids WAL-related I/O issues during virtual table creation.
  // See: https://www.sqlite.org/wal.html
  try {
    // Checkpoint and switch to DELETE mode (this forces WAL to be fully written to main DB)
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.exec("PRAGMA journal_mode = DELETE");

    // Create virtual table in DELETE mode (no WAL interference)
    db.exec(
      `CREATE VIRTUAL TABLE vectors_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${dimensions}] distance_metric=cosine)`,
    );

    // Switch back to WAL mode for normal operations
    db.exec("PRAGMA journal_mode = WAL");
  } catch (error) {
    // Ensure we're back in WAL mode even on error
    try {
      db.exec("PRAGMA journal_mode = WAL");
    } catch {
      // Ignore
    }
    throw error;
  }
}


function isRecoverableSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("sqlite_ioerr_short_read") || lower.includes("disk i/o error");
}

function deleteDbFiles(path: string): void {
  const wal = `${path}-wal`;
  const shm = `${path}-shm`;
  if (existsSync(path)) unlinkSync(path);
  if (existsSync(wal)) unlinkSync(wal);
  if (existsSync(shm)) unlinkSync(shm);
}
