import { getDb } from "../index.js";

const VARIABLE_KEY_REGEX = /^[a-z0-9_]+$/;

export function normalizeVariableName(name) {
  let value = (name || "").trim().toLowerCase();
  if (!value) return "";
  value = value.replace(/\s+/g, "_");
  if (!VARIABLE_KEY_REGEX.test(value)) return "";
  return value;
}

export async function listVariables({ deviceId = null } = {}, logger) {
  const db = await getDb(logger);
  const clauses = [];
  const params = [];
  if (deviceId) {
    clauses.push("(device_id is null or device_id = ?)");
    params.push(deviceId);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const rows = await db.all(
    `select id, name, value, device_id as deviceId, created_at as createdAt, updated_at as updatedAt
     from chatbot_variables
     ${where}
     order by id asc`,
    params
  );
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.name,
    value: row.value,
    deviceId: row.deviceId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
}

export async function createVariable({ name, value, deviceId }, logger) {
  const db = await getDb(logger);
  const normalizedName = normalizeVariableName(name);
  if (!normalizedName) throw new Error("NOME_INVALIDO");
  const normalizedValue = (value || "").trim();
  if (!normalizedValue) throw new Error("VALOR_INVALIDO");
  const res = await db.run(
    "insert into chatbot_variables (name, value, device_id) values (?, ?, ?)",
    normalizedName,
    normalizedValue,
    deviceId || null
  );
  return {
    id: res.lastID,
    name: normalizedName,
    value: normalizedValue,
    deviceId: deviceId || null
  };
}

export async function updateVariable(id, { name, value, deviceId }, logger) {
  const db = await getDb(logger);
  const normalizedName = normalizeVariableName(name);
  if (!normalizedName) throw new Error("NOME_INVALIDO");
  const normalizedValue = (value || "").trim();
  if (!normalizedValue) throw new Error("VALOR_INVALIDO");
  await db.run(
    "update chatbot_variables set name = ?, value = ?, device_id = ?, updated_at = datetime('now') where id = ?",
    normalizedName,
    normalizedValue,
    deviceId || null,
    id
  );
  return { id, name: normalizedName, value: normalizedValue, deviceId: deviceId || null };
}

export async function deleteVariable(id, logger) {
  const db = await getDb(logger);
  await db.run("delete from chatbot_variables where id = ?", id);
}
