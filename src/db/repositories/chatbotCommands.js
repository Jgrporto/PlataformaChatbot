import { getDb } from "../index.js";

const VALID_TYPES = new Set(["test", "reply"]);

export function normalizeAgentTrigger(trigger) {
  let value = (trigger || "").trim();
  if (!value) return "";
  if (!value.startsWith("#")) return "";
  value = value.replace(/\s+/g, " ");
  if (value.length <= 1) return "";
  return value.toLowerCase();
}

function normalizeCommandType(commandType) {
  const value = (commandType || "reply").trim().toLowerCase();
  return VALID_TYPES.has(value) ? value : "";
}

export async function listAgentCommands({ includeDisabled = true, deviceId = null } = {}, logger) {
  const db = await getDb(logger);
  const clauses = [];
  const params = [];
  if (!includeDisabled) {
    clauses.push("enabled = 1");
  }
  if (deviceId) {
    clauses.push("(device_id is null or device_id = ?)");
    params.push(deviceId);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const rows = await db.all(
    `select id, trigger, response_template as responseTemplate, command_type as commandType, enabled,
      device_id as deviceId, created_at as createdAt, updated_at as updatedAt
     from chatbot_agent_commands
     ${where}
     order by id asc`,
    params
  );
  return (rows || []).map((row) => ({
    id: row.id,
    trigger: normalizeAgentTrigger(row.trigger) || row.trigger,
    responseTemplate: row.responseTemplate,
    commandType: row.commandType || "reply",
    enabled: !!row.enabled,
    deviceId: row.deviceId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
}

export async function createAgentCommand({ trigger, responseTemplate, commandType, enabled, deviceId }, logger) {
  const db = await getDb(logger);
  const trig = normalizeAgentTrigger(trigger);
  if (!trig) throw new Error("TRIGGER_INVALIDO");
  const response = (responseTemplate || "").trim();
  if (!response) throw new Error("RESPOSTA_INVALIDA");
  const type = normalizeCommandType(commandType);
  if (!type) throw new Error("TIPO_INVALIDO");
  const res = await db.run(
    "insert into chatbot_agent_commands (trigger, response_template, command_type, enabled, device_id) values (?, ?, ?, ?, ?)",
    trig,
    response,
    type,
    enabled === false ? 0 : 1,
    deviceId || null
  );
  return {
    id: res.lastID,
    trigger: trig,
    responseTemplate: response,
    commandType: type,
    enabled: enabled !== false,
    deviceId: deviceId || null
  };
}

export async function updateAgentCommand(id, { trigger, responseTemplate, commandType, enabled, deviceId }, logger) {
  const db = await getDb(logger);
  const trig = normalizeAgentTrigger(trigger);
  if (!trig) throw new Error("TRIGGER_INVALIDO");
  const response = (responseTemplate || "").trim();
  if (!response) throw new Error("RESPOSTA_INVALIDA");
  const type = normalizeCommandType(commandType);
  if (!type) throw new Error("TIPO_INVALIDO");
  await db.run(
    "update chatbot_agent_commands set trigger = ?, response_template = ?, command_type = ?, enabled = ?, device_id = ?, updated_at = datetime('now') where id = ?",
    trig,
    response,
    type,
    enabled === false ? 0 : 1,
    deviceId || null,
    id
  );
  return {
    id,
    trigger: trig,
    responseTemplate: response,
    commandType: type,
    enabled: enabled !== false,
    deviceId: deviceId || null
  };
}

export async function deleteAgentCommand(id, logger) {
  const db = await getDb(logger);
  await db.run("delete from chatbot_agent_commands where id = ?", id);
}
