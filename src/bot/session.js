import wweb from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { normalizeToE164BR } from "../../utils/phone.js";
import { createMessageProcessor, createSessionCache, createSessionState } from "./messageProcessor.js";

const { Client, LocalAuth } = wweb;
const AUTH_PATH = process.env.WWEB_AUTH_PATH || ".wwebjs_auth";

export function createSession({
  deviceId,
  name,
  configService,
  followUpService,
  logger,
  onStatus,
  onActivity,
  onInteraction,
  onMessage
}) {
  const state = createSessionState();
  const cache = createSessionCache();
  const processor = createMessageProcessor({
    deviceId,
    logger,
    configService,
    followUpService,
    onActivity,
    onInteraction,
    onMessage
  });

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH, clientId: `device_${deviceId}` }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
  });

  const session = {
    id: deviceId,
    name,
    client,
    state,
    cache,
    processor,
    latestQr: "",
    latestQrAt: null,
    status: "disconnected",
    ready: false,
    lastActivity: null,
    lastError: null
  };

  function updateStatus(status, errorText) {
    session.status = status;
    session.lastError = errorText || null;
    if (onStatus) {
      onStatus({ status, lastError: session.lastError, lastActivity: session.lastActivity });
    }
  }

  function touchActivity() {
    session.lastActivity = new Date().toISOString();
    if (onActivity) onActivity(session.lastActivity);
  }

  client.on("qr", (qr) => {
    touchActivity();
    session.latestQr = qr;
    session.latestQrAt = new Date().toISOString();
    updateStatus("awaiting_qr", null);
    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qr)}`;
    logger?.info?.(`[${session.name}] QR Code gerado: ${qrImgUrl}`);
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => {
    touchActivity();
    session.ready = true;
    updateStatus("connected", null);
    logger?.info?.(`[${session.name}] Cliente WhatsApp conectado e pronto para receber mensagens.`);
    followUpService?.tick().catch((err) => logger?.error?.("[FollowUp] Tick inicial falhou", err));
  });

  client.on("auth_failure", (msg) => {
    touchActivity();
    session.ready = false;
    updateStatus("disconnected", msg || "auth_failure");
    logger?.warn?.(`[${session.name}] Falha de autenticacao: ${msg || "auth_failure"}`);
  });

  client.on("disconnected", (reason) => {
    touchActivity();
    session.ready = false;
    updateStatus("disconnected", reason || "disconnected");
    logger?.warn?.(`[${session.name}] Cliente desconectado: ${reason || "disconnected"}`);
  });

  client.on("message", async (msg) => {
    touchActivity();

    const isFromMe = !!msg.fromMe;
    const msgId = processor.getSerializedMessageId(msg);

    if (isFromMe) {
      if (msgId && session.cache.botSentMessageIds.has(msgId)) {
        session.cache.botSentMessageIds.delete(msgId);
        return;
      }
      const fpKeyOut = `${msg?.to || msg?.from || ""}|${(msg?.body || "").trim()}`;
      const fpExpOut = session.cache.botSentFingerprints.get(fpKeyOut);
      if (fpExpOut) {
        session.cache.botSentFingerprints.delete(fpKeyOut);
        if (fpExpOut > Date.now()) return;
      }
      if (msgId && session.cache.agentProcessedMessageIds.has(msgId)) return;

      const contentAgent = processor.formatConteudoParaLog(msg);
      let result = null;
      let errorForLog = null;

      try {
        result = await processor.processAgentMessage(session, msg);
      } catch (err) {
        errorForLog = { type: "PROCESS_ERROR", details: err?.message || "Falha ao processar comando do agente", err };
        logger?.error?.("Erro ao processar mensagem (AGENTE)", err);
      }

      const ctx = result?.ctx || {
        contactType: processor.resolveTipoContato(null, msg?.to || msg?.from || ""),
        name: "",
        phoneE164: normalizeToE164BR(msg?.to || msg?.from || "") || "",
        chatId: msg?.to || msg?.from || "",
        origin: "AGENTE",
        sessionName: session.name
      };
      const content = result?.content || contentAgent;
      const errBlock = errorForLog || result?.errorForLog ? { error: errorForLog || result?.errorForLog } : {};
      logger?.messageSent?.(ctx, content, errBlock);
      await processor.logMessageEvent({
        deviceId,
        phone: ctx.phoneE164,
        chatId: ctx.chatId,
        origin: ctx.origin,
        direction: "out",
        messageType: msg?.type || "text",
        content
      });
      await processor.logInteractionEvent({
        deviceId,
        phone: ctx.phoneE164,
        name: ctx.name,
        contactType: ctx.contactType,
        origin: ctx.origin,
        eventType: "message_sent",
        content,
        errorType: errBlock?.error?.type,
        errorDetails: errBlock?.error?.details
      });
      if (msgId) session.cache.agentProcessedMessageIds.add(msgId);
      return;
    }

    const content = processor.formatConteudoParaLog(msg);
    try {
      const result = await processor.processMessage(session, msg);
      logger?.messageReceived?.(result.ctx, content, result.errorForLog ? { error: result.errorForLog } : {});
      await processor.logMessageEvent({
        deviceId,
        phone: result.ctx.phoneE164,
        chatId: result.ctx.chatId,
        origin: result.ctx.origin,
        direction: "in",
        messageType: msg?.type || "text",
        content
      });
      await processor.logInteractionEvent({
        deviceId,
        phone: result.ctx.phoneE164,
        name: result.ctx.name,
        contactType: result.ctx.contactType,
        origin: result.ctx.origin,
        eventType: "message_received",
        content,
        errorType: result.errorForLog?.type,
        errorDetails: result.errorForLog?.details
      });
    } catch (err) {
      logger?.error?.("Erro ao processar mensagem", err);
      const chatId = msg?.from || "";
      const fallbackCtx = {
        contactType: processor.resolveTipoContato(null, chatId),
        name: "",
        phoneE164: normalizeToE164BR(chatId) || "",
        chatId,
        origin: "CLIENTE",
        sessionName: session.name
      };
      logger?.messageReceived?.(fallbackCtx, content, {
        error: { type: "PROCESS_ERROR", details: err?.message || "Falha ao processar mensagem", err }
      });
      await processor.logInteractionEvent({
        deviceId,
        phone: fallbackCtx.phoneE164,
        name: fallbackCtx.name,
        contactType: fallbackCtx.contactType,
        origin: fallbackCtx.origin,
        eventType: "message_received",
        content,
        errorType: "PROCESS_ERROR",
        errorDetails: err?.message || "Falha ao processar mensagem"
      });
    }
  });

  client.on("message_create", async (msg) => {
    if (!msg.fromMe) return;
    touchActivity();

    const msgId = msg?.id?._serialized;
    if (msgId && session.cache.botSentMessageIds.has(msgId)) {
      session.cache.botSentMessageIds.delete(msgId);
      return;
    }

    const corpo = (msg.body || "").trim();

    const fpKey = `${msg?.to || ""}|${corpo}`;
    const fpExp = session.cache.botSentFingerprints.get(fpKey);
    if (fpExp) {
      session.cache.botSentFingerprints.delete(fpKey);
      if (fpExp > Date.now()) return;
    }

    const targetChatId = msg?.to || "";
    const agentMsgId = processor.getSerializedMessageId(msg);
    if (agentMsgId && session.cache.agentProcessedMessageIds.has(agentMsgId)) return;

    let ctxToLog = null;
    let contentToLog = null;
    let errorForLog = null;

    try {
      const result = await processor.processAgentMessage(session, msg);
      ctxToLog = result?.ctx || null;
      contentToLog = result?.content || null;
      errorForLog = result?.errorForLog || null;
    } catch (err) {
      errorForLog = { type: "PROCESS_ERROR", details: err?.message || "Falha ao processar comando do agente", err };
      logger?.error?.("Erro ao processar message_create (AGENTE)", err);
    } finally {
      const fallbackCtx = ctxToLog || {
        contactType: processor.resolveTipoContato(null, targetChatId),
        name: "",
        phoneE164: normalizeToE164BR(targetChatId) || "",
        chatId: targetChatId,
        origin: "AGENTE",
        sessionName: session.name
      };
      const fallbackContent = contentToLog || (corpo || "<sem texto>");
      logger?.messageSent?.(fallbackCtx, fallbackContent, errorForLog ? { error: errorForLog } : {});
      await processor.logMessageEvent({
        deviceId,
        phone: fallbackCtx.phoneE164,
        chatId: fallbackCtx.chatId,
        origin: fallbackCtx.origin,
        direction: "out",
        messageType: msg?.type || "text",
        content: fallbackContent
      });
      await processor.logInteractionEvent({
        deviceId,
        phone: fallbackCtx.phoneE164,
        name: fallbackCtx.name,
        contactType: fallbackCtx.contactType,
        origin: fallbackCtx.origin,
        eventType: "message_sent",
        content: fallbackContent,
        errorType: errorForLog?.type,
        errorDetails: errorForLog?.details
      });
      if (agentMsgId) session.cache.agentProcessedMessageIds.add(agentMsgId);
    }
  });

  session.start = () => {
    client.initialize();
  };

  session.stop = async () => {
    try {
      await client.destroy();
    } catch (err) {
      logger?.warn?.(`[${session.name}] Falha ao destruir cliente`, { error: err?.message });
    }
  };

  session.markBotSent = (chatId, text) => {
    processor.markBotSent(session, chatId, text);
  };

  return session;
}
