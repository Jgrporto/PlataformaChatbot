import pg from "pg";

const { Pool } = pg;

function shouldUseSsl() {
  const mode = (process.env.PGSSLMODE || "").toLowerCase();
  if (mode === "disable") return false;
  if (process.env.PGSSL === "false") return false;
  if (process.env.DATABASE_URL) return true;
  return false;
}

const poolConfig = {};
if (process.env.DATABASE_URL) {
  poolConfig.connectionString = process.env.DATABASE_URL;
}
const ssl = shouldUseSsl();
if (ssl) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

let pool = null;

export function isDbEnabled() {
  return !!process.env.DATABASE_URL || !!process.env.PGHOST;
}

export function getPool() {
  if (!pool) {
    pool = new Pool(poolConfig);
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

export async function initDb(logger) {
  if (!isDbEnabled()) {
    logger?.warn("[DB] DATABASE_URL/PGHOST nao configurado; banco desativado.");
    return false;
  }

  try {
    await query("select 1");
    logger?.info("[DB] Conexao com Postgres OK.");
    return true;
  } catch (err) {
    logger?.error("[DB] Falha ao conectar no Postgres", err);
    return false;
  }
}
