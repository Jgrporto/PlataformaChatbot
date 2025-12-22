import { getDb } from "../index.js";

export async function logTestRun({ deviceId, flow, payload, response, status, errorText }, logger) {
  const db = await getDb(logger);
  await db.run(
    "insert into api_tests (device_id, flow, payload_json, response_json, status, error_text, created_at) values (?, ?, ?, ?, ?, ?, datetime('now'))",
    deviceId || null,
    flow || null,
    payload ? JSON.stringify(payload) : null,
    response ? JSON.stringify(response) : null,
    status || "unknown",
    errorText || null
  );
}

export async function listTests(filters = {}, logger) {
  const db = await getDb(logger);
  const params = [];
  const clauses = [];

  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }

  if (filters.deviceId) {
    clauses.push("device_id = ?");
    params.push(filters.deviceId);
  }

  if (filters.from) {
    clauses.push("created_at >= ?");
    params.push(filters.from);
  }

  if (filters.to) {
    clauses.push("created_at <= ?");
    params.push(filters.to);
  }

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const rows = await db.all(
    `select id, device_id as deviceId, flow, payload_json as payloadJson, response_json as responseJson,
      status, error_text as errorText, created_at as createdAt
     from api_tests
     ${where}
     order by created_at desc
     limit 500`,
    params
  );
  return (rows || []).map((row) => ({
    id: row.id,
    deviceId: row.deviceId,
    flow: row.flow,
    payload: safeJson(row.payloadJson),
    response: safeJson(row.responseJson),
    status: row.status,
    errorText: row.errorText,
    createdAt: row.createdAt
  }));
}

export async function getTestById(id, logger) {
  const db = await getDb(logger);
  const row = await db.get(
    `select id, device_id as deviceId, flow, payload_json as payloadJson, response_json as responseJson,
      status, error_text as errorText, created_at as createdAt
     from api_tests where id = ?`,
    id
  );
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.deviceId,
    flow: row.flow,
    payload: safeJson(row.payloadJson),
    response: safeJson(row.responseJson),
    status: row.status,
    errorText: row.errorText,
    createdAt: row.createdAt
  };
}

function safeJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
