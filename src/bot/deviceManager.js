import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { createSession } from "./session.js";
import {
  listDevices,
  createDevice as createDeviceRecord,
  getDeviceById,
  updateDeviceStatus,
  deleteDevice as deleteDeviceRecord,
  upsertDevice
} from "../db/repositories/devices.js";

const AUTH_PATH = process.env.WWEB_AUTH_PATH || ".wwebjs_auth";
const AUTO_START_SESSIONS = process.env.AUTO_START_SESSIONS !== "0";
const SESSION_NAMES = (process.env.SESSION_NAMES || "Venda 1")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

export class DeviceManager {
  constructor({
    logger,
    configService,
    commandsService,
    followUpService,
    onInteraction,
    onMessage,
    onBroadcast,
    onActivity
  } = {}) {
    this.logger = logger;
    this.configService = configService;
    this.commandsService = commandsService;
    this.followUpService = followUpService;
    this.onInteraction = onInteraction;
    this.onMessage = onMessage;
    this.onBroadcast = onBroadcast;
    this.onActivity = onActivity;
    this.sessions = new Map();
    this.lastActivityById = new Map();
  }

  async init() {
    const existing = await listDevices(this.logger);
    if (!existing.length) {
      for (const name of SESSION_NAMES) {
        const id = `device_${randomUUID().slice(0, 8)}`;
        await createDeviceRecord({ id, name, status: "disconnected" }, this.logger);
      }
    }

    if (!AUTO_START_SESSIONS) return;
    const devices = await listDevices(this.logger);
    for (const device of devices) {
      const hasAuth = await this.hasAuth(device.id);
      if (hasAuth) {
        await this.startSession(device, { qrRequested: false });
      }
    }
  }

  async startSession(device, { qrRequested = false } = {}) {
    if (!device?.id) return null;
    const existing = this.sessions.get(device.id);
    if (existing) return existing;

    const session = createSession({
      deviceId: device.id,
      name: device.name,
      qrRequested,
      configService: this.configService,
      commandsService: this.commandsService,
      followUpService: this.followUpService,
      logger: this.logger,
      onInteraction: this.onInteraction,
      onMessage: this.onMessage,
      onActivity: (ts) => this.touchActivity(device.id, ts),
      onStatus: (statusUpdate) => this.handleStatus(device.id, statusUpdate)
    });

    this.sessions.set(device.id, session);
    session.start();
    return session;
  }

  async handleStatus(deviceId, statusUpdate) {
    const lastActivity = statusUpdate?.lastActivity || new Date().toISOString();
    await updateDeviceStatus(
      deviceId,
      {
        status: statusUpdate.status,
        lastActivity,
        lastError: statusUpdate.lastError || null,
        devicePhone: statusUpdate.devicePhone || null
      },
      this.logger
    );
    await this.broadcast("device.updated", {
      deviceId,
      status: statusUpdate.status,
      lastActivity,
      devicePhone: statusUpdate.devicePhone || null
    });
  }

  async touchActivity(deviceId, ts) {
    const now = Date.now();
    const prev = this.lastActivityById.get(deviceId) || 0;
    if (now - prev < 5000) return;
    this.lastActivityById.set(deviceId, now);
    await updateDeviceStatus(
      deviceId,
      { status: this.sessions.get(deviceId)?.status || "connected", lastActivity: ts, lastError: null },
      this.logger
    );
    if (this.onActivity) this.onActivity(deviceId, ts);
  }

  async listDevices() {
    const devices = await listDevices(this.logger);
    return devices.map((device) => {
      const session = this.sessions.get(device.id);
      return {
        ...device,
        status: session?.status || device.status,
        lastActivity: session?.lastActivity || device.lastActivity,
        lastError: session?.lastError || device.lastError,
        devicePhone: session?.devicePhone || device.devicePhone || null,
        qr: session?.latestQr || null,
        qrIssuedAt: session?.latestQrAt || null
      };
    });
  }

  getQr(deviceId) {
    const session = this.sessions.get(deviceId);
    return session?.latestQr || null;
  }

  getQrMeta(deviceId) {
    const session = this.sessions.get(deviceId);
    return {
      qr: session?.latestQr || null,
      issuedAt: session?.latestQrAt || null,
      status: session?.status || "disconnected"
    };
  }

  getSession(deviceId) {
    return this.sessions.get(deviceId) || null;
  }

  async createDevice({ id, name }) {
    const deviceId = id || `device_${randomUUID().slice(0, 8)}`;
    const deviceName = (name || "").trim() || deviceId;
    const created = await createDeviceRecord({ id: deviceId, name: deviceName, status: "disconnected" }, this.logger);
    await this.broadcast("device.created", created);
    return created;
  }

  async reconnectDevice(deviceId) {
    const session = this.sessions.get(deviceId);
    let sessionName = session?.name || "";
    if (session) {
      await session.stop();
      this.sessions.delete(deviceId);
    } else {
      const deviceRecord = await getDeviceById(deviceId, this.logger);
      sessionName = deviceRecord?.name || sessionName;
    }
    await this.removeAuth(deviceId);
    if (!sessionName) return null;
    const device = await upsertDevice({ id: deviceId, name: sessionName, status: "disconnected" }, this.logger);
    const restarted = await this.startSession(device, { qrRequested: true });
    await this.broadcast("device.reconnected", { deviceId });
    return restarted ? device : null;
  }

  async requestQr(deviceId) {
    const session = this.sessions.get(deviceId);
    if (session) {
      if (session.ready) {
        session.qrRequested = true;
        return session;
      }
      await session.stop();
      this.sessions.delete(deviceId);
    }
    const device = await getDeviceById(deviceId, this.logger);
    if (!device) return null;
    return this.startSession(device, { qrRequested: true });
  }

  async removeDevice(deviceId) {
    const session = this.sessions.get(deviceId);
    if (!session) return false;
    await session.stop();
    this.sessions.delete(deviceId);
    await deleteDeviceRecord(deviceId, this.logger);
    await this.removeAuth(deviceId);
    await this.broadcast("device.removed", { deviceId });
    return true;
  }

  async removeAuth(deviceId) {
    const folder = path.join(AUTH_PATH, `device_${deviceId}`);
    try {
      await fs.rm(folder, { recursive: true, force: true });
    } catch (err) {
      this.logger?.warn?.("[Device] Falha ao remover auth", { deviceId, error: err?.message });
    }
  }

  async broadcast(type, payload) {
    if (!this.onBroadcast) return;
    try {
      await this.onBroadcast(type, payload);
    } catch (err) {
      this.logger?.warn?.("[WS] Falha ao enviar evento", { type, error: err?.message });
    }
  }

  async hasAuth(deviceId) {
    const folder = path.join(AUTH_PATH, `device_${deviceId}`);
    try {
      const entries = await fs.readdir(folder);
      return entries.length > 0;
    } catch {
      return false;
    }
  }
}
