import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { createSession } from "./session.js";
import {
  listDevices,
  createDevice as createDeviceRecord,
  updateDeviceStatus,
  deleteDevice as deleteDeviceRecord,
  upsertDevice
} from "../db/repositories/devices.js";

const AUTH_PATH = process.env.WWEB_AUTH_PATH || ".wwebjs_auth";
const SESSION_NAMES = (process.env.SESSION_NAMES || "Venda 1")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

export class DeviceManager {
  constructor({ logger, configService, followUpService, onInteraction, onMessage, onBroadcast, onActivity } = {}) {
    this.logger = logger;
    this.configService = configService;
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

    const devices = await listDevices(this.logger);
    for (const device of devices) {
      await this.startSession(device);
    }
  }

  async startSession(device) {
    if (!device?.id) return null;
    const existing = this.sessions.get(device.id);
    if (existing) return existing;

    const session = createSession({
      deviceId: device.id,
      name: device.name,
      configService: this.configService,
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
        lastError: statusUpdate.lastError || null
      },
      this.logger
    );
    await this.broadcast("device.updated", { deviceId, status: statusUpdate.status, lastActivity });
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
      issuedAt: session?.latestQrAt || null
    };
  }

  getSession(deviceId) {
    return this.sessions.get(deviceId) || null;
  }

  async createDevice({ id, name }) {
    const deviceId = id || `device_${randomUUID().slice(0, 8)}`;
    const deviceName = (name || "").trim() || deviceId;
    const created = await createDeviceRecord({ id: deviceId, name: deviceName, status: "disconnected" }, this.logger);
    await this.startSession(created);
    await this.broadcast("device.created", created);
    return created;
  }

  async reconnectDevice(deviceId) {
    const session = this.sessions.get(deviceId);
    if (!session) return null;
    await session.stop();
    this.sessions.delete(deviceId);
    await this.removeAuth(deviceId);
    const device = await upsertDevice({ id: deviceId, name: session.name, status: "disconnected" }, this.logger);
    const restarted = await this.startSession(device);
    await this.broadcast("device.reconnected", { deviceId });
    return restarted ? device : null;
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
}
