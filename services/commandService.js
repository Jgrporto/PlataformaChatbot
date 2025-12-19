import { initDb, isDbEnabled, query } from "./db.js";

const DEFAULT_COMMANDS = [
  { token: "#IBO", flow: "IBO", enabled: true },
  { token: "#ASSIST", flow: "ASSIST", enabled: true },
  { token: "#LAZER", flow: "LAZER", enabled: true },
  { token: "#FUN", flow: "FUN", enabled: true },
  { token: "#PLAYSIM", flow: "PLAYSIM", enabled: true }
];

const VALID_FLOWS = new Set(["IBO", "ASSIST", "LAZER", "FUN", "PLAYSIM"]);
const CACHE_MS = Number(process.env.COMMANDS_CACHE_MS || 4000);

let cache = {
  items: null,
  loadedAt: 0,
  dbReady: false
};

function normalizeToken(token) {
  let value = (token || "").trim().toUpperCase();
  if (!value) return "";
  if (!value.startsWith("#")) value = `#${value}`;
  return value;
}

function normalizeFlow(flow) {
  return (flow || "").trim().toUpperCase();
}

function ensureValidFlow(flow) {
  const normalized = normalizeFlow(flow);
  if (!VALID_FLOWS.has(normalized)) {
    const valid = Array.from(VALID_FLOWS).join(", ");
    throw new Error(`FLOW_INVALIDO: ${normalized || "vazio"} (validos: ${valid})`);
  }
  return normalized;
}

async function ensureSchema() {
  await query(
    `create table if not exists commands (
      id serial primary key,
      token text not null unique,
      flow text not null,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`
  );
  await query("create index if not exists idx_commands_flow on commands(flow)");
}

async function seedDefaultsIfEmpty() {
  const res = await query("select count(*)::int as count from commands");
  if ((res?.rows?.[0]?.count || 0) > 0) return;
  for (const cmd of DEFAULT_COMMANDS) {
    await query(
      "insert into commands (token, flow, enabled) values ($1, $2, $3)",
      [cmd.token, cmd.flow, cmd.enabled]
    );
  }
}

async function fetchCommandsFromDb() {
  const res = await query(
    "select id, token, flow, enabled, created_at, updated_at from commands order by id asc"
  );
  return (res?.rows || []).map((row) => ({
    id: row.id,
    token: normalizeToken(row.token),
    flow: normalizeFlow(row.flow),
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function setCache(items) {
  cache.items = items;
  cache.loadedAt = Date.now();
}

export async function initCommandStore(logger) {
  cache.dbReady = await initDb(logger);
  if (!cache.dbReady) {
    setCache(DEFAULT_COMMANDS.map((cmd, idx) => ({ id: idx + 1, ...cmd })));
    return false;
  }

  await ensureSchema();
  await seedDefaultsIfEmpty();
  const items = await fetchCommandsFromDb();
  setCache(items);
  return true;
}

export function getValidFlows() {
  return Array.from(VALID_FLOWS);
}

export async function getCommands({ includeDisabled = true } = {}) {
  if (!cache.dbReady || !isDbEnabled()) {
    return includeDisabled
      ? cache.items || DEFAULT_COMMANDS
      : (cache.items || DEFAULT_COMMANDS).filter((cmd) => cmd.enabled);
  }

  const now = Date.now();
  if (!cache.items || now - cache.loadedAt > CACHE_MS) {
    const items = await fetchCommandsFromDb();
    setCache(items);
  }

  return includeDisabled ? cache.items : cache.items.filter((cmd) => cmd.enabled);
}

export async function getCommandIndex() {
  const items = await getCommands({ includeDisabled: true });
  const activeByToken = new Map();
  const tokensAll = [];
  for (const cmd of items) {
    const token = normalizeToken(cmd.token);
    tokensAll.push(token);
    if (cmd.enabled) activeByToken.set(token, { ...cmd, token });
  }
  return { items, activeByToken, tokensAll };
}

export async function createCommand({ token, flow, enabled }) {
  if (!cache.dbReady) throw new Error("DB_INDISPONIVEL");
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) throw new Error("TOKEN_INVALIDO");
  const normalizedFlow = ensureValidFlow(flow);
  const isEnabled = enabled !== false;
  const res = await query(
    "insert into commands (token, flow, enabled) values ($1, $2, $3) returning id, token, flow, enabled, created_at, updated_at",
    [normalizedToken, normalizedFlow, isEnabled]
  );
  const row = res?.rows?.[0];
  cache.loadedAt = 0;
  return row
    ? {
        id: row.id,
        token: normalizeToken(row.token),
        flow: normalizeFlow(row.flow),
        enabled: !!row.enabled,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;
}

export async function updateCommand(id, { token, flow, enabled }) {
  if (!cache.dbReady) throw new Error("DB_INDISPONIVEL");
  const normalizedToken = normalizeToken(token);
  const normalizedFlow = ensureValidFlow(flow);
  const isEnabled = enabled !== false;
  const res = await query(
    "update commands set token = $1, flow = $2, enabled = $3, updated_at = now() where id = $4 returning id, token, flow, enabled, created_at, updated_at",
    [normalizedToken, normalizedFlow, isEnabled, id]
  );
  const row = res?.rows?.[0];
  cache.loadedAt = 0;
  return row
    ? {
        id: row.id,
        token: normalizeToken(row.token),
        flow: normalizeFlow(row.flow),
        enabled: !!row.enabled,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;
}

export async function deleteCommand(id) {
  if (!cache.dbReady) throw new Error("DB_INDISPONIVEL");
  await query("delete from commands where id = $1", [id]);
  cache.loadedAt = 0;
}
