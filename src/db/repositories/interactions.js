import { getDb } from "../index.js";

function buildRangeClause({ from, to }, params) {
  const clauses = [];
  if (from) {
    clauses.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("created_at <= ?");
    params.push(to);
  }
  return clauses;
}

export async function logInteraction(event, logger) {
  const db = await getDb(logger);
  await db.run(
    `insert into interactions (
      device_id, phone, name, contact_type, origin, event_type, command, flow, stage,
      content, message_id, error_type, error_details, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    event.deviceId || null,
    event.phone || null,
    event.name || null,
    event.contactType || null,
    event.origin || null,
    event.eventType || "message",
    event.command || null,
    event.flow || null,
    event.stage || null,
    event.content || null,
    event.messageId || null,
    event.errorType || null,
    event.errorDetails || null
  );
}

export async function logMessage(message, logger) {
  const db = await getDb(logger);
  await db.run(
    `insert into messages (
      device_id, phone, chat_id, origin, direction, message_type, content, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    message.deviceId || null,
    message.phone || null,
    message.chatId || null,
    message.origin || null,
    message.direction || null,
    message.messageType || null,
    message.content || null
  );
}

export async function listInteractions(filters = {}, logger) {
  const db = await getDb(logger);
  const params = [];
  const clauses = [];

  if (filters.deviceId) {
    clauses.push("device_id = ?");
    params.push(filters.deviceId);
  }

  if (filters.q) {
    clauses.push("(phone like ? or name like ? or content like ? or flow like ? or command like ?)");
    const like = `%${filters.q}%`;
    params.push(like, like, like, like, like);
  }

  clauses.push(...buildRangeClause(filters, params));

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const rows = await db.all(
    `select id, device_id as deviceId, phone, name, contact_type as contactType, origin, event_type as eventType,
      command, flow, stage, content, message_id as messageId, error_type as errorType, error_details as errorDetails,
      created_at as createdAt
     from interactions
     ${where}
     order by created_at desc
     limit 500`,
    params
  );
  return rows || [];
}

export async function getContactHistory(phone, logger) {
  const db = await getDb(logger);
  const rows = await db.all(
    `select id, device_id as deviceId, phone, chat_id as chatId, origin, direction, message_type as messageType,
      content, created_at as createdAt
     from messages
     where phone = ?
     order by created_at asc
     limit 500`,
    phone
  );
  return rows || [];
}
