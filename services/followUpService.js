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
  constructor({ storagePath, delayMs, tickMs = DEFAULT_TICK_MS, logger }) {
    this.storagePath = storagePath;
    this.delayMs = delayMs;
    this.tickMs = tickMs;
    this.logger = logger;
    this.sendMessage = null;

    this.byChatId = new Map(); // chatId -> record
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
      this.byChatId.set(rec.chatId, rec);
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
    const records = Array.from(this.byChatId.values());
    await writeJsonAtomic(this.storagePath, { records });
  }

  schedule({ clientPhone, chatId, createdAt, clientName }) {
    const created = createdAt instanceof Date ? createdAt.toISOString() : createdAt;
    const rec = {
      id: randomUUID(),
      clientPhone: clientPhone || "",
      chatId,
      createdAt: created || new Date().toISOString(),
      clientName: clientName || ""
    };

    this.byChatId.set(chatId, rec);
    this.persist().catch((err) => this.logger?.error("[FollowUp] Persist falhou", err));
  }

  buildMessage(rec) {
    const nome = (rec?.clientName || "").trim();
    return `Seu teste terminou. ${nome ? `${nome}, ` : ""}como foi o teste?`;
  }

  async tick() {
    const now = Date.now();
    const due = [];

    for (const rec of this.byChatId.values()) {
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
        this.byChatId.delete(rec.chatId);
        await this.persist();
      } catch (err) {
        this.logger?.error("[FollowUp] Falha ao enviar follow-up", err, { chatId: rec.chatId });
      }
    }
  }
}
