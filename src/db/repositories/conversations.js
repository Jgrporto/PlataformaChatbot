import { randomUUID } from "crypto";
import { getDb } from "../index.js";

function buildProtocol() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const suffix = randomUUID().slice(0, 6);
  return `${stamp}-${suffix}`;
}

function deviceClause(deviceId, params) {
  if (deviceId) {
    params.push(deviceId);
    return "device_id = ?";
  }
  return "device_id is null";
}

export async function ensureConversation({ deviceId = null, phone, name }, logger) {
  if (!phone) return null;
  const db = await getDb(logger);
  const params = [phone];
  const deviceWhere = deviceClause(deviceId, params);
  const row = await db.get(
    `select id, protocol, device_id as deviceId, phone, name, status, flow, stage,
      last_message as lastMessage, last_message_at as lastMessageAt,
      started_at as startedAt, closed_at as closedAt
     from conversations
     where phone = ? and ${deviceWhere} and status = 'open'
     order by started_at desc
     limit 1`,
    params
  );
  if (row) {
    if (name && !row.name) {
      await db.run("update conversations set name = ? where id = ?", name, row.id);
      row.name = name;
    }
    return row;
  }

  const protocol = buildProtocol();
  const res = await db.run(
    "insert into conversations (protocol, device_id, phone, name, status, started_at) values (?, ?, ?, ?, 'open', datetime('now'))",
    protocol,
    deviceId || null,
    phone,
    name || null
  );
  return getConversationById(res.lastID, logger);
}

export async function touchConversation({ deviceId = null, phone, name, lastMessage, lastMessageAt }, logger) {
  if (!phone) return null;
  const convo = await ensureConversation({ deviceId, phone, name }, logger);
  if (!convo) return null;
  const db = await getDb(logger);
  await db.run(
    `update conversations set
      name = coalesce(?, name),
      last_message = coalesce(?, last_message),
      last_message_at = coalesce(?, last_message_at)
     where id = ?`,
    name || null,
    lastMessage || null,
    lastMessageAt || null,
    convo.id
  );
  return convo;
}

export async function updateConversationFlow({ deviceId = null, phone, flow, stage }, logger) {
  if (!phone || !flow) return null;
  const convo = await ensureConversation({ deviceId, phone }, logger);
  if (!convo) return null;
  const db = await getDb(logger);
  await db.run("update conversations set flow = ?, stage = ? where id = ?", flow, stage || null, convo.id);
  return convo;
}

export async function closeConversation({ deviceId = null, phone }, logger) {
  if (!phone) return;
  const db = await getDb(logger);
  const params = [phone];
  const deviceWhere = deviceClause(deviceId, params);
  await db.run(
    `update conversations set status = 'closed', closed_at = datetime('now')
     where phone = ? and ${deviceWhere} and status = 'open'`,
    params
  );
}

export async function listConversations({ deviceId, q, status } = {}, logger) {
  const db = await getDb(logger);
  const clauses = [];
  const params = [];

  if (deviceId) {
    clauses.push("c.device_id = ?");
    params.push(deviceId);
  }
  if (status) {
    clauses.push("c.status = ?");
    params.push(status);
  }
  if (q) {
    clauses.push("(c.phone like ? or c.name like ? or c.protocol like ? or c.last_message like ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const rows = await db.all(
    `select c.id, c.protocol, c.device_id as deviceId, c.phone, c.name, c.status, c.flow, c.stage,
      c.last_message as lastMessage, c.last_message_at as lastMessageAt,
      c.started_at as startedAt, c.closed_at as closedAt,
      d.name as deviceName, d.device_phone as devicePhone
     from conversations c
     left join devices d on d.id = c.device_id
     ${where}
     order by coalesce(c.last_message_at, c.started_at) desc
     limit 300`,
    params
  );
  return rows || [];
}

export async function getConversationById(id, logger) {
  const db = await getDb(logger);
  const row = await db.get(
    `select c.id, c.protocol, c.device_id as deviceId, c.phone, c.name, c.status, c.flow, c.stage,
      c.last_message as lastMessage, c.last_message_at as lastMessageAt,
      c.started_at as startedAt, c.closed_at as closedAt,
      d.name as deviceName, d.device_phone as devicePhone
     from conversations c
     left join devices d on d.id = c.device_id
     where c.id = ?`,
    id
  );
  return row || null;
}

export async function getConversationDetails(id, logger) {
  const db = await getDb(logger);
  const convo = await getConversationById(id, logger);
  if (!convo) return null;

  const params = [convo.phone];
  let deviceClauseSql = "";
  if (convo.deviceId) {
    deviceClauseSql = "and device_id = ?";
    params.push(convo.deviceId);
  }

  const messages = await db.all(
    `select id, device_id as deviceId, phone, chat_id as chatId, origin, direction, message_type as messageType,
      content, created_at as createdAt
     from messages
     where phone = ? ${deviceClauseSql} and created_at >= ?
     order by created_at asc
     limit 500`,
    [...params, convo.startedAt]
  );

  const flowEvents = await db.all(
    `select id, event_type as eventType, flow, stage, content, created_at as createdAt
     from interactions
     where phone = ? ${deviceClauseSql} and created_at >= ?
       and event_type in ('flow_started', 'flow_stage', 'command', 'message_received', 'message_sent')
     order by created_at asc
     limit 500`,
    [...params, convo.startedAt]
  );

  return { ...convo, messages: messages || [], flowEvents: flowEvents || [] };
}

export async function getLatestChatId({ phone, deviceId }, logger) {
  if (!phone) return null;
  const db = await getDb(logger);
  const params = [phone];
  let deviceClauseSql = "";
  if (deviceId) {
    deviceClauseSql = "and device_id = ?";
    params.push(deviceId);
  }
  const row = await db.get(
    `select chat_id as chatId from messages where phone = ? ${deviceClauseSql} order by created_at desc limit 1`,
    params
  );
  return row?.chatId || null;
}
