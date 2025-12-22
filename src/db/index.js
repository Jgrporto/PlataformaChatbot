import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { runMigrations } from "./migrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DB_PATH = process.env.DB_PATH || path.join(ROOT_DIR, "data", "app.db");

let dbPromise = null;

export async function getDb(logger) {
  if (!dbPromise) {
    dbPromise = (async () => {
      await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
      const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
      await db.exec("pragma foreign_keys = on");
      await runMigrations(db, logger);
      return db;
    })();
  }
  return dbPromise;
}

export async function initDb(logger) {
  try {
    await getDb(logger);
    logger?.info?.(`[DB] SQLite pronto em ${DB_PATH}`);
    return true;
  } catch (err) {
    logger?.error?.("[DB] Falha ao iniciar SQLite", err);
    return false;
  }
}

export function getDbPath() {
  return DB_PATH;
}
