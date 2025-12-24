import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import http from "http";
import axios from "axios";
import { logger } from "../utils/logger.js";
import { initDb } from "./db/index.js";
import { ChatbotConfigService } from "./services/chatbotConfigService.js";
import { ChatbotCommandsService } from "./services/chatbotCommandsService.js";
import { setupAuth } from "./api/auth.js";
import { registerDeviceRoutes } from "./api/devices.js";
import { registerChatbotRoutes } from "./api/chatbot.js";
import { registerInteractionRoutes } from "./api/interactions.js";
import { registerTestRoutes } from "./api/tests.js";
import { registerConversationRoutes } from "./api/conversations.js";
import { registerFollowupRoutes } from "./api/followups.js";
import { DeviceManager } from "./bot/deviceManager.js";
import { FollowUpService } from "../services/followUpService.js";
import { logInteraction, logMessage } from "./db/repositories/interactions.js";
import { setupRealtime } from "./realtime/socket.js";
import { normalizeToE164BR } from "../utils/phone.js";

const PORT = Number(process.env.PORT || 3200);
const FOLLOWUP_MS = Number(process.env.FOLLOWUP_MS || 4 * 60 * 60 * 1000);
const FOLLOWUP_STORAGE_PATH = process.env.FOLLOWUP_STORAGE_PATH || "data/followups.json";
const SELF_PING_URL = process.env.SELF_PING_URL || "";
const IDLE_LOG_MS = Number(process.env.IDLE_LOG_MS || 300000);
const SESSION_NAMES = (process.env.SESSION_NAMES || "Venda 1")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const DEFAULT_SESSION_NAME = SESSION_NAMES[0] || "Venda 1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const ADMIN_DIST = path.join(ROOT_DIR, "admin", "dist");
const ADMIN_DIR = fs.existsSync(ADMIN_DIST) ? ADMIN_DIST : null;

let lastActivity = Date.now();
const touchActivity = () => {
  lastActivity = Date.now();
};

function isTargetClosedError(err) {
  if (!err) return false;
  const msg = err?.message || "";
  const original = err?.originalMessage || "";
  const text = `${msg} ${original}`.toLowerCase();
  return text.includes("target closed") || text.includes("protocol error (runtime.callfunctionon)");
}

function setupProcessGuards() {
  process.on("unhandledRejection", (reason) => {
    if (isTargetClosedError(reason)) {
      logger.warn("[Process] Puppeteer target fechado", { message: reason?.message || reason });
      return;
    }
    logger.error("[Process] Unhandled rejection", reason);
  });

  process.on("uncaughtException", (err) => {
    if (isTargetClosedError(err)) {
      logger.warn("[Process] Puppeteer target fechado", { message: err?.message || err });
      return;
    }
    logger.error("[Process] Uncaught exception", err);
  });
}

async function start() {
  await initDb(logger);

  const configService = new ChatbotConfigService({ logger });
  await configService.init();
  const commandsService = new ChatbotCommandsService({ logger });

  const followUpService = new FollowUpService({
    storagePath: FOLLOWUP_STORAGE_PATH,
    delayMs: FOLLOWUP_MS,
    logger,
    defaultSessionName: DEFAULT_SESSION_NAME
  });

  const app = express();
  app.use(express.json({ limit: "200kb" }));
  app.use(express.urlencoded({ extended: true }));

  const server = http.createServer(app);
  const realtime = setupRealtime(server, { logger });

  const deviceManager = new DeviceManager({
    logger,
    configService,
    commandsService,
    followUpService,
    onInteraction: async (event) => {
      await logInteraction(event, logger);
      await realtime.broadcast("interaction.new", event);
    },
    onMessage: async (event) => {
      await logMessage(event, logger);
      await realtime.broadcast("message.new", event);
    },
    onBroadcast: async (type, payload) => {
      await realtime.broadcast(type, payload);
    },
    onActivity: (deviceId, ts) => {
      touchActivity();
      realtime.broadcast("device.activity", { deviceId, lastActivity: ts });
    }
  });

  followUpService.setSender(async (rec, message) => {
    let session = rec?.deviceId ? deviceManager.getSession(rec.deviceId) : null;
    if (!session && rec?.sessionName) {
      session = Array.from(deviceManager.sessions.values()).find((s) => s.name === rec.sessionName) || null;
    }
    if (!session) {
      const err = new Error("Sessao nao encontrada para follow-up");
      err.code = "SESSION_NOT_FOUND";
      throw err;
    }
    if (!session.ready) {
      const err = new Error(`Sessao ${session.name} ainda nao pronta`);
      err.code = "SESSION_NOT_READY";
      throw err;
    }

    const chatId = rec.chatId;
    const phoneE164 = normalizeToE164BR(rec.clientPhone) || rec.clientPhone || "";
    const ctx = {
      contactType: chatId?.endsWith("@g.us") ? "GRUPO" : "CONTATO",
      name: (rec?.clientName || "").trim(),
      phoneE164,
      chatId,
      origin: "BOT",
      sessionName: session.name
    };

    session.markBotSent(chatId, message);
    const sent = await session.client.sendMessage(chatId, message);
    logger.messageSent(ctx, message);
    await logMessage(
      {
        deviceId: rec.deviceId || session.id,
        phone: phoneE164,
        chatId,
        origin: ctx.origin,
        direction: "out",
        messageType: "text",
        content: message
      },
      logger
    );
    await logInteraction(
      {
        deviceId: rec.deviceId || session.id,
        phone: phoneE164,
        name: ctx.name,
        contactType: ctx.contactType,
        origin: ctx.origin,
        eventType: "message_sent",
        content: message
      },
      logger
    );
    return sent;
  });

  const requireAuth = setupAuth(app, { logger });

  registerDeviceRoutes(app, { deviceManager, requireAuth });
  registerChatbotRoutes(app, { configService, commandsService, requireAuth });
  registerInteractionRoutes(app, { requireAuth, logger });
  registerTestRoutes(app, { requireAuth, logger });
  registerConversationRoutes(app, { requireAuth, logger, deviceManager });
  registerFollowupRoutes(app, { requireAuth, followUpService });

  app.get("/api/commands", requireAuth, async (_req, res) => {
    const commands = await configService.getCommands({ includeDisabled: true });
    res.json(commands);
  });

  app.get("/api/commands/flows", requireAuth, async (_req, res) => {
    const flows = await configService.getFlows({ includeDisabled: true });
    res.json(flows.map((flow) => flow.name));
  });

  if (ADMIN_DIR) {
    app.use("/admin", express.static(ADMIN_DIR));
    app.get(/^\/admin\/.*$/, (_req, res) => {
      res.sendFile(path.join(ADMIN_DIR, "index.html"));
    });
  } else {
    app.get(/^\/admin\/.*$/, (_req, res) => {
      res.status(500).send("Painel nao compilado. Rode npm run build:admin.");
    });
  }

  app.get("/", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/qr", async (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>QR WhatsApp</title>
    <style>
      body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; }
      .shell { max-width: 1100px; margin: 0 auto; padding: 32px 20px; }
      .grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      .card { background: #1e293b; padding: 18px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); text-align: center; }
      .card h3 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
      .qr { margin: 8px auto; width: 220px; height: 220px; }
      .info { font-size: 13px; color: #cbd5e1; margin-top: 12px; }
    </style>
  </head>
  <body>
    <div class="shell">
      <h2>QRs das sessoes</h2>
      <div id="qr-grid" class="grid"></div>
      <div class="info">Atualiza automaticamente a cada 6s.</div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>
      async function loadQr() {
        const res = await fetch("/qr.json");
        const data = await res.json();
        const grid = document.getElementById("qr-grid");
        grid.innerHTML = "";
        (data.sessions || []).forEach((sess) => {
          const card = document.createElement("div");
          card.className = "card";
          card.innerHTML = "<h3>" + (sess.name || "Sessao") + "</h3>" +
            "<div class='qr'></div>" +
            "<div class='info'>" + (sess.qr ? "Pronto para escanear" : "QR ainda nao gerado") + "</div>";
          grid.appendChild(card);
          if (sess.qr) {
            new QRCode(card.querySelector(".qr"), {
              text: sess.qr,
              width: 220,
              height: 220
            });
          }
        });
      }
      loadQr();
      setInterval(loadQr, 6000);
    </script>
  </body>
</html>`;
    res.send(html);
  });

  app.get("/qr.json", async (_req, res) => {
    const devices = await deviceManager.listDevices();
    res.json({
      sessions: devices.map((device) => ({
        id: device.id,
        name: device.name,
        qr: device.qr || null
      }))
    });
  });

  app.use((_req, res) => res.status(404).send("Not found"));

  await deviceManager.init();
  await followUpService.init();

  server.listen(PORT, () => {
    logger.info(`Servidor em http://localhost:${PORT}`);
  });

  startKeepAlive();
  startIdleLog();
}

function startKeepAlive() {
  if (!SELF_PING_URL) {
    logger.info("Keep-alive desativado (defina SELF_PING_URL para habilitar).");
    return;
  }
  const interval = Number(process.env.SELF_PING_INTERVAL_MS || 240000);
  logger.info(`Keep-alive ligado: ping em ${SELF_PING_URL} a cada ${interval} ms`);
  setInterval(() => {
    axios
      .get(SELF_PING_URL)
      .then(() => logger.info("Keep-alive ping OK"))
      .catch((err) => logger.warn("Keep-alive falhou", { message: err?.message }));
  }, interval);
}

function startIdleLog() {
  setInterval(() => {
    const agora = Date.now();
    if (agora - lastActivity >= IDLE_LOG_MS) {
      logger.info("Aguardando mensagens...");
      touchActivity();
    }
  }, Math.max(60000, Math.min(IDLE_LOG_MS, 300000)));
}

setupProcessGuards();
start().catch((err) => {
  logger.error("[Server] Falha fatal ao iniciar", err);
  process.exit(1);
});
