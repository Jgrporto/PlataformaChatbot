function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDateTime(dt = new Date()) {
  const y = dt.getFullYear();
  const m = pad2(dt.getMonth() + 1);
  const d = pad2(dt.getDate());
  const hh = pad2(dt.getHours());
  const mm = pad2(dt.getMinutes());
  const ss = pad2(dt.getSeconds());
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function blockLine() {
  return "────────────────────────────────────────";
}

function safe(v, fallback = "") {
  const s = (v ?? "").toString();
  return s.trim() ? s : fallback;
}

function summarizeStack(err) {
  if (!err) return "";
  const stack = (err.stack || err.message || "").toString();
  if (!stack.trim()) return "";
  const firstLines = stack.split(/\r?\n/).slice(0, 3).map((l) => l.trim()).filter(Boolean);
  return firstLines.join(" | ");
}

function write(lines, { stderr = false } = {}) {
  const text = `${lines.join("\n")}\n`;
  (stderr ? process.stderr : process.stdout).write(text);
}

function formatEventHeader(title) {
  return [blockLine(), title, blockLine()];
}

function formatErrorBlock({ type, details, err }) {
  const out = [];
  out.push("⚠️ ERRO DETECTADO");
  out.push(`Tipo: ${safe(type, "N/A")}`);
  if (details) out.push(`Detalhes: ${safe(details)}`);
  const stack = summarizeStack(err);
  if (stack) out.push(`Stack: ${stack}`);
  return out;
}

function formatMessageContent(content) {
  const body = safe(content, "<sem texto>");
  return [`💬 Conteúdo:`, `"${body}"`];
}

function formatMessageEvent({
  event,
  origin,
  contactType,
  name,
  phoneE164,
  chatId,
  sessionName,
  content,
  error
}) {
  const dt = formatDateTime(new Date());
  const lines = [
    ...formatEventHeader(event),
    `🕒 Data/Hora: ${dt}`
  ];

  if (contactType) lines.push(`👤 Tipo de Contato: ${contactType}`);
  if (origin) lines.push(`🤖 Origem: ${origin}`);
  if (name !== undefined) lines.push(`📛 Nome WhatsApp: ${safe(name, "<sem nome>")}`);
  if (phoneE164 !== undefined) lines.push(`📱 Telefone: ${safe(phoneE164, "<desconhecido>")}`);
  if (chatId !== undefined) lines.push(`🆔 Chat ID: ${safe(chatId, "<desconhecido>")}`);
  if (sessionName !== undefined) lines.push(`Sessao: ${safe(sessionName, "<desconhecida>")}`);
  lines.push(...formatMessageContent(content));

  if (error) lines.push(...formatErrorBlock(error));
  lines.push(blockLine());
  return lines;
}

export function createLogger() {
  return {
    info(message, meta) {
      const prefix = `[${formatDateTime()}] [INFO]`;
      write([`${prefix} ${safe(message)}`, meta ? JSON.stringify(meta) : ""].filter(Boolean));
    },

    warn(message, meta) {
      const prefix = `[${formatDateTime()}] [WARN]`;
      write([`${prefix} ${safe(message)}`, meta ? JSON.stringify(meta) : ""].filter(Boolean));
    },

    error(message, err, meta) {
      const prefix = `[${formatDateTime()}] [ERROR]`;
      const lines = [`${prefix} ${safe(message)}`];
      const stack = summarizeStack(err);
      if (stack) lines.push(`Stack: ${stack}`);
      if (meta) lines.push(JSON.stringify(meta));
      write(lines, { stderr: true });
    },

    messageReceived(ctx, content, { error } = {}) {
      write(
        formatMessageEvent({
          event: "📩 EVENTO: MENSAGEM RECEBIDA",
          origin: safe(ctx?.origin),
          contactType: safe(ctx?.contactType),
          name: ctx?.name,
          phoneE164: ctx?.phoneE164,
          chatId: ctx?.chatId,
          sessionName: ctx?.sessionName,
          content,
          error
        })
      );
    },

    messageSent(ctx, content, { error } = {}) {
      write(
        formatMessageEvent({
          event: "📤 EVENTO: MENSAGEM ENVIADA",
          origin: safe(ctx?.origin),
          contactType: safe(ctx?.contactType),
          name: ctx?.name,
          phoneE164: ctx?.phoneE164,
          chatId: ctx?.chatId,
          sessionName: ctx?.sessionName,
          content,
          error
        })
      );
    }
  };
}

export const logger = createLogger();

