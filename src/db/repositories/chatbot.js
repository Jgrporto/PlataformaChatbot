import { getDb } from "../index.js";

const DEFAULT_COMMANDS = [
  { token: "#IBO", flow: "IBO", enabled: true },
  { token: "#ASSIST", flow: "ASSIST", enabled: true },
  { token: "#LAZER", flow: "LAZER", enabled: true },
  { token: "#FUN", flow: "FUN", enabled: true },
  { token: "#PLAYSIM", flow: "PLAYSIM", enabled: true }
];

const DEFAULT_FLOWS = [
  { name: "IBO", flowType: "builtin" },
  { name: "ASSIST", flowType: "builtin" },
  { name: "LAZER", flowType: "builtin" },
  { name: "FUN", flowType: "builtin" },
  { name: "PLAYSIM", flowType: "builtin" }
];

function normalizeToken(token) {
  let value = (token || "").trim().toUpperCase();
  if (!value) return "";
  if (!value.startsWith("#")) value = `#${value}`;
  return value;
}

function normalizeFlow(flow) {
  return (flow || "").trim().toUpperCase();
}

function normalizeMatchType(matchType) {
  const value = (matchType || "includes").trim().toLowerCase();
  return ["includes", "exact", "starts_with"].includes(value) ? value : "includes";
}

export async function seedDefaults(logger) {
  const db = await getDb(logger);
  const count = await db.get("select count(*) as count from chatbot_commands");
  if ((count?.count || 0) === 0) {
    for (const cmd of DEFAULT_COMMANDS) {
      await db.run(
        "insert into chatbot_commands (token, flow, enabled) values (?, ?, ?)",
        normalizeToken(cmd.token),
        normalizeFlow(cmd.flow),
        cmd.enabled ? 1 : 0
      );
    }
  }

  const flowCount = await db.get("select count(*) as count from chatbot_flows");
  if ((flowCount?.count || 0) === 0) {
    for (const flow of DEFAULT_FLOWS) {
      await db.run(
        "insert into chatbot_flows (name, flow_type, triggers_json, stages_json, enabled) values (?, ?, '[]', '[]', 1)",
        normalizeFlow(flow.name),
        flow.flowType
      );
    }
  }
}

export async function listCommands({ includeDisabled = true, deviceId = null } = {}, logger) {
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
    `select id, token, flow, enabled, device_id as deviceId, created_at as createdAt, updated_at as updatedAt
     from chatbot_commands
     ${where}
     order by id asc`,
    params
  );
  return (rows || []).map((row) => ({
    id: row.id,
    token: normalizeToken(row.token),
    flow: normalizeFlow(row.flow),
    enabled: !!row.enabled,
    deviceId: row.deviceId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
}

export async function createCommand({ token, flow, enabled, deviceId }, logger) {
  const db = await getDb(logger);
  const normalizedToken = normalizeToken(token);
  const normalizedFlow = normalizeFlow(flow);
  if (!normalizedToken) throw new Error("TOKEN_INVALIDO");
  if (!normalizedFlow) throw new Error("FLOW_INVALIDO");
  const res = await db.run(
    "insert into chatbot_commands (token, flow, enabled, device_id) values (?, ?, ?, ?)",
    normalizedToken,
    normalizedFlow,
    enabled === false ? 0 : 1,
    deviceId || null
  );
  return {
    id: res.lastID,
    token: normalizedToken,
    flow: normalizedFlow,
    enabled: enabled !== false,
    deviceId: deviceId || null
  };
}

export async function updateCommand(id, { token, flow, enabled, deviceId }, logger) {
  const db = await getDb(logger);
  const normalizedToken = normalizeToken(token);
  const normalizedFlow = normalizeFlow(flow);
  if (!normalizedToken) throw new Error("TOKEN_INVALIDO");
  if (!normalizedFlow) throw new Error("FLOW_INVALIDO");
  await db.run(
    "update chatbot_commands set token = ?, flow = ?, enabled = ?, device_id = ?, updated_at = datetime('now') where id = ?",
    normalizedToken,
    normalizedFlow,
    enabled === false ? 0 : 1,
    deviceId || null,
    id
  );
  return { id, token: normalizedToken, flow: normalizedFlow, enabled: enabled !== false, deviceId: deviceId || null };
}

export async function deleteCommand(id, logger) {
  const db = await getDb(logger);
  await db.run("delete from chatbot_commands where id = ?", id);
}

export async function listQuickReplies({ includeDisabled = true, deviceId = null } = {}, logger) {
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
    `select id, trigger, response, match_type as matchType, enabled, device_id as deviceId, created_at as createdAt, updated_at as updatedAt
     from chatbot_quick_replies
     ${where}
     order by id asc`,
    params
  );
  return (rows || []).map((row) => ({
    id: row.id,
    trigger: row.trigger,
    response: row.response,
    matchType: row.matchType || "includes",
    enabled: !!row.enabled,
    deviceId: row.deviceId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
}

export async function createQuickReply({ trigger, response, matchType, enabled, deviceId }, logger) {
  const db = await getDb(logger);
  const trig = (trigger || "").trim();
  if (!trig) throw new Error("TRIGGER_INVALIDO");
  const resp = (response || "").trim();
  if (!resp) throw new Error("RESPOSTA_INVALIDA");
  const normalizedMatch = normalizeMatchType(matchType);
  const res = await db.run(
    "insert into chatbot_quick_replies (trigger, response, match_type, enabled, device_id) values (?, ?, ?, ?, ?)",
    trig,
    resp,
    normalizedMatch,
    enabled === false ? 0 : 1,
    deviceId || null
  );
  return {
    id: res.lastID,
    trigger: trig,
    response: resp,
    matchType: normalizedMatch,
    enabled: enabled !== false,
    deviceId: deviceId || null
  };
}

export async function updateQuickReply(id, { trigger, response, matchType, enabled, deviceId }, logger) {
  const db = await getDb(logger);
  const trig = (trigger || "").trim();
  if (!trig) throw new Error("TRIGGER_INVALIDO");
  const resp = (response || "").trim();
  if (!resp) throw new Error("RESPOSTA_INVALIDA");
  const normalizedMatch = normalizeMatchType(matchType);
  await db.run(
    "update chatbot_quick_replies set trigger = ?, response = ?, match_type = ?, enabled = ?, device_id = ?, updated_at = datetime('now') where id = ?",
    trig,
    resp,
    normalizedMatch,
    enabled === false ? 0 : 1,
    deviceId || null,
    id
  );
  return {
    id,
    trigger: trig,
    response: resp,
    matchType: normalizedMatch,
    enabled: enabled !== false,
    deviceId: deviceId || null
  };
}

export async function deleteQuickReply(id, logger) {
  const db = await getDb(logger);
  await db.run("delete from chatbot_quick_replies where id = ?", id);
}

export async function listFlows({ includeDisabled = true, deviceId = null } = {}, logger) {
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
    `select id, name, triggers_json as triggersJson, stages_json as stagesJson, flow_type as flowType, enabled,
     device_id as deviceId, created_at as createdAt, updated_at as updatedAt
     from chatbot_flows
     ${where}
     order by id asc`,
    params
  );
  return (rows || []).map((row) => ({
    id: row.id,
    name: normalizeFlow(row.name),
    triggers: safeJsonArray(row.triggersJson),
    stages: safeJsonArray(row.stagesJson),
    flowType: row.flowType || "custom",
    enabled: !!row.enabled,
    deviceId: row.deviceId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
}

export async function createFlow({ name, triggers, stages, flowType, enabled, deviceId }, logger) {
  const db = await getDb(logger);
  const normalizedName = normalizeFlow(name);
  if (!normalizedName) throw new Error("FLOW_INVALIDO");
  const trig = Array.isArray(triggers) ? triggers : [];
  const stg = Array.isArray(stages) ? stages : [];
  const type = (flowType || "custom").trim().toLowerCase();
  const res = await db.run(
    "insert into chatbot_flows (name, triggers_json, stages_json, flow_type, enabled, device_id) values (?, ?, ?, ?, ?, ?)",
    normalizedName,
    JSON.stringify(trig),
    JSON.stringify(stg),
    type,
    enabled === false ? 0 : 1,
    deviceId || null
  );
  return {
    id: res.lastID,
    name: normalizedName,
    triggers: trig,
    stages: stg,
    flowType: type,
    enabled: enabled !== false,
    deviceId: deviceId || null
  };
}

export async function updateFlow(id, { name, triggers, stages, flowType, enabled, deviceId }, logger) {
  const db = await getDb(logger);
  const normalizedName = normalizeFlow(name);
  if (!normalizedName) throw new Error("FLOW_INVALIDO");
  const trig = Array.isArray(triggers) ? triggers : [];
  const stg = Array.isArray(stages) ? stages : [];
  const type = (flowType || "custom").trim().toLowerCase();
  await db.run(
    "update chatbot_flows set name = ?, triggers_json = ?, stages_json = ?, flow_type = ?, enabled = ?, device_id = ?, updated_at = datetime('now') where id = ?",
    normalizedName,
    JSON.stringify(trig),
    JSON.stringify(stg),
    type,
    enabled === false ? 0 : 1,
    deviceId || null,
    id
  );
  return {
    id,
    name: normalizedName,
    triggers: trig,
    stages: stg,
    flowType: type,
    enabled: enabled !== false,
    deviceId: deviceId || null
  };
}

export async function deleteFlow(id, logger) {
  const db = await getDb(logger);
  await db.run("delete from chatbot_flows where id = ?", id);
}

function safeJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
