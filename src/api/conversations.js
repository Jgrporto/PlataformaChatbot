import {
  getConversationDetails,
  listConversations,
  getLatestChatId,
  closeConversation
} from "../db/repositories/conversations.js";
import { logInteraction, logMessage } from "../db/repositories/interactions.js";
import { normalizeToE164BR } from "../../utils/phone.js";

function toChatId(phone, fallbackChatId) {
  if (fallbackChatId) return fallbackChatId;
  const digits = (phone || "").replace(/[^\d]/g, "");
  return digits ? `${digits}@c.us` : null;
}

export function registerConversationRoutes(app, { requireAuth, logger, deviceManager }) {
  app.get("/api/conversations", requireAuth, async (req, res) => {
    try {
      const data = await listConversations(
        { deviceId: req.query.deviceId || null, q: req.query.q || "", status: req.query.status || "" },
        logger
      );
      res.json(data);
    } catch (err) {
      res.status(500).send(err?.message || "Erro ao listar conversas.");
    }
  });

  app.get("/api/conversations/:id", requireAuth, async (req, res) => {
    try {
      const data = await getConversationDetails(req.params.id, logger);
      if (!data) return res.status(404).send("Conversa nao encontrada.");
      res.json(data);
    } catch (err) {
      res.status(500).send(err?.message || "Erro ao buscar conversa.");
    }
  });

  app.post("/api/conversations/:id/send", requireAuth, async (req, res) => {
    const message = (req.body?.message || "").trim();
    if (!message) return res.status(400).send("Mensagem vazia.");

    try {
      const convo = await getConversationDetails(req.params.id, logger);
      if (!convo) return res.status(404).send("Conversa nao encontrada.");

      const deviceId = req.body?.deviceId || convo.deviceId || null;
      if (!deviceId) return res.status(400).send("Device nao definido.");
      const session = deviceManager.getSession(deviceId);
      if (!session || !session.ready) return res.status(409).send("Sessao nao conectada.");

      const phone = convo.phone || "";
      const phoneE164 = normalizeToE164BR(phone) || phone;
      const lastChatId = await getLatestChatId({ phone, deviceId }, logger);
      const chatId = toChatId(phone, lastChatId);
      if (!chatId) return res.status(400).send("ChatId nao encontrado.");

      session.markBotSent(chatId, message);
      await session.client.sendMessage(chatId, message);

      await logMessage(
        {
          deviceId,
          phone: phoneE164,
          chatId,
          origin: "AGENTE",
          direction: "out",
          messageType: "text",
          content: message
        },
        logger
      );
      await logInteraction(
        {
          deviceId,
          phone: phoneE164,
          name: convo.name || "",
          contactType: "CONTATO",
          origin: "AGENTE",
          eventType: "message_sent",
          content: message
        },
        logger
      );

      res.status(204).end();
    } catch (err) {
      res.status(500).send(err?.message || "Erro ao enviar mensagem.");
    }
  });

  app.post("/api/conversations/:id/close", requireAuth, async (req, res) => {
    try {
      const convo = await getConversationDetails(req.params.id, logger);
      if (!convo) return res.status(404).send("Conversa nao encontrada.");
      await closeConversation({ deviceId: convo.deviceId, phone: convo.phone }, logger);
      await logInteraction(
        {
          deviceId: convo.deviceId,
          phone: convo.phone,
          name: convo.name || "",
          contactType: "CONTATO",
          origin: "AGENTE",
          eventType: "conversation_closed",
          content: "Finalizado manualmente"
        },
        logger
      );
      res.status(204).end();
    } catch (err) {
      res.status(500).send(err?.message || "Erro ao finalizar conversa.");
    }
  });
}
