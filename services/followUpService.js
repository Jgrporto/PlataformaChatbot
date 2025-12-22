import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const DEFAULT_TICK_MS = 60_000;

async function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
}

async function readJson(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

async function writeJsonAtomic(filePath, data) {
  await ensureDirForFile(filePath);
  const tmp = `${filePath}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.promises.rename(tmp, filePath);
}

export class FollowUpService {
  constructor({ storagePath, delayMs, tickMs = DEFAULT_TICK_MS, logger, defaultSessionName = "" }) {
    this.storagePath = storagePath;
    this.delayMs = delayMs;
    this.tickMs = tickMs;
    this.logger = logger;
    this.defaultSessionName = defaultSessionName;
    this.sendMessage = null;

    this.byChatKey = new Map(); // sessionName|chatId -> record
    this.timer = null;
  }

  setSender(sendMessageFn) {
    this.sendMessage = sendMessageFn;
  }

  async init() {
    const saved = await readJson(this.storagePath);
    const records = Array.isArray(saved?.records) ? saved.records : [];

    for (const rec of records) {
      if (!rec?.chatId || !rec?.createdAt) continue;
      const normalized = this.normalizeRecord(rec);
      this.byChatKey.set(this.buildKey(normalized), normalized);
    }

    await this.persist();

    if (!this.timer) {
      this.timer = setInterval(() => {
        this.tick().catch((err) => this.logger?.error("[FollowUp] Tick falhou", err));
      }, this.tickMs);
      this.timer.unref?.();
    }

    await this.tick();
  }

  async persist() {
    const records = Array.from(this.byChatKey.values());
    await writeJsonAtomic(this.storagePath, { records });
  }

  schedule({ clientPhone, chatId, createdAt, clientName, sessionName, deviceId }) {
    const created = createdAt instanceof Date ? createdAt.toISOString() : createdAt;
    const rec = {
      id: randomUUID(),
      clientPhone: clientPhone || "",
      chatId,
      createdAt: created || new Date().toISOString(),
      clientName: clientName || "",
      sessionName: sessionName || this.defaultSessionName || "",
      deviceId: deviceId || ""
    };

    this.byChatKey.set(this.buildKey(rec), rec);
    this.persist().catch((err) => this.logger?.error("[FollowUp] Persist falhou", err));
  }

  buildMessage(rec) {
    const nome = (rec?.clientName || "").trim();
    return `Seu teste terminou. ${nome ? `${nome}, ` : ""}como foi o teste?`;
  }

  async tick() {
    const now = Date.now();
    const due = [];

    for (const rec of this.byChatKey.values()) {
      const createdMs = Date.parse(rec.createdAt);
      if (!Number.isFinite(createdMs)) continue;
      const dueAt = createdMs + this.delayMs;
      if (now >= dueAt) due.push(rec);
    }

    if (!due.length) return;
    if (!this.sendMessage) {
      this.logger?.warn("[FollowUp] Sender ainda não disponível; aguardando WhatsApp pronto");
      return;
    }

    for (const rec of due) {
      try {
        await this.sendMessage(rec, this.buildMessage(rec));
        this.byChatKey.delete(this.buildKey(rec));
        await this.persist();
      } catch (err) {
        if (err?.code === "SESSION_NOT_READY") {
          this.logger?.warn("[FollowUp] Sessao nao pronta para follow-up; mantendo registro", {
            chatId: rec.chatId
          });
          continue;
        }
        this.logger?.error("[FollowUp] Falha ao enviar follow-up", err, { chatId: rec.chatId });
      }
    }
  }

  buildKey(rec) {
    const sessionName = rec?.sessionName || this.defaultSessionName || "";
    return `${sessionName}|${rec?.chatId || ""}`;
  }

  normalizeRecord(rec) {
    if (rec?.sessionName) return rec;
    return {
      ...rec,
      sessionName: this.defaultSessionName || ""
    };
  }
}
