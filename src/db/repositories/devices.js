import { getDb } from "../index.js";

export async function listDevices(logger) {
  const db = await getDb(logger);
  const rows = await db.all(
    "select id, name, status, last_activity as lastActivity, last_error as lastError, created_at as createdAt, updated_at as updatedAt from devices order by created_at asc"
  );
  return rows || [];
}

export async function getDeviceById(id, logger) {
  const db = await getDb(logger);
  const row = await db.get(
    "select id, name, status, last_activity as lastActivity, last_error as lastError, created_at as createdAt, updated_at as updatedAt from devices where id = ?",
    id
  );
  return row || null;
}

export async function upsertDevice({ id, name, status = "disconnected", lastActivity = null, lastError = null }, logger) {
  const db = await getDb(logger);
  await db.run(
    `insert into devices (id, name, status, last_activity, last_error) values (?, ?, ?, ?, ?)
     on conflict(id) do update set name = excluded.name, status = excluded.status, last_activity = excluded.last_activity, last_error = excluded.last_error, updated_at = datetime('now')`,
    id,
    name,
    status,
    lastActivity,
    lastError
  );
  return getDeviceById(id, logger);
}

export async function createDevice({ id, name, status = "disconnected" }, logger) {
  const db = await getDb(logger);
  await db.run(
    "insert into devices (id, name, status) values (?, ?, ?)",
    id,
    name,
    status
  );
  return getDeviceById(id, logger);
}

export async function updateDeviceStatus(id, { status, lastActivity, lastError }, logger) {
  const db = await getDb(logger);
  await db.run(
    "update devices set status = ?, last_activity = ?, last_error = ?, updated_at = datetime('now') where id = ?",
    status,
    lastActivity,
    lastError,
    id
  );
  return getDeviceById(id, logger);
}

export async function deleteDevice(id, logger) {
  const db = await getDb(logger);
  await db.run("delete from devices where id = ?", id);
}
