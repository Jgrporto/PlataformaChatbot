import {
  seedDefaults,
  listCommands,
  createCommand,
  updateCommand,
  deleteCommand,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  listFlows,
  createFlow,
  updateFlow,
  deleteFlow
} from "../db/repositories/chatbot.js";

const CACHE_MS = Number(process.env.CHATBOT_CACHE_MS || 4000);

function normalizeToken(token) {
  let value = (token || "").trim().toUpperCase();
  if (!value) return "";
  if (!value.startsWith("#")) value = `#${value}`;
  return value;
}

function matchesTrigger(text, trigger, matchType) {
  const value = (text || "").toLowerCase();
  const target = (trigger || "").toLowerCase();
  if (!target) return false;
  if (matchType === "exact") return value === target;
  if (matchType === "starts_with") return value.startsWith(target);
  return value.includes(target);
}

export class ChatbotConfigService {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.cache = {
      commands: [],
      quickReplies: [],
      flows: [],
      loadedAt: 0
    };
  }

  async init() {
    await seedDefaults(this.logger);
    await this.refresh();
  }

  async refresh() {
    const [commands, quickReplies, flows] = await Promise.all([
      listCommands({ includeDisabled: true }, this.logger),
      listQuickReplies({ includeDisabled: true }, this.logger),
      listFlows({ includeDisabled: true }, this.logger)
    ]);
    this.cache = { commands, quickReplies, flows, loadedAt: Date.now() };
  }

  async ensureFresh() {
    if (!this.cache.loadedAt || Date.now() - this.cache.loadedAt > CACHE_MS) {
      await this.refresh();
    }
  }

  async getCommands({ includeDisabled = true, deviceId = null } = {}) {
    await this.ensureFresh();
    const filtered = this.filterByDevice(this.cache.commands, deviceId);
    return includeDisabled ? filtered : filtered.filter((c) => c.enabled);
  }

  async getQuickReplies({ includeDisabled = true, deviceId = null } = {}) {
    await this.ensureFresh();
    const filtered = this.filterByDevice(this.cache.quickReplies, deviceId);
    return includeDisabled ? filtered : filtered.filter((q) => q.enabled);
  }

  async getFlows({ includeDisabled = true, deviceId = null } = {}) {
    await this.ensureFresh();
    const filtered = this.filterByDevice(this.cache.flows, deviceId);
    return includeDisabled ? filtered : filtered.filter((f) => f.enabled);
  }

  async getCommandIndex(deviceId = null) {
    const commands = await this.getCommands({ includeDisabled: true, deviceId });
    const activeByToken = new Map();
    const tokensAll = [];
    for (const cmd of commands) {
      const token = normalizeToken(cmd.token);
      tokensAll.push(token);
      if (cmd.enabled && !activeByToken.has(token)) activeByToken.set(token, { ...cmd, token });
    }
    return { items: commands, activeByToken, tokensAll };
  }

  async findQuickReply(text, deviceId = null) {
    await this.ensureFresh();
    const value = (text || "").trim();
    if (!value) return null;
    const items = this.filterByDevice(this.cache.quickReplies, deviceId);
    return items.find((item) => item.enabled && matchesTrigger(value, item.trigger, item.matchType)) || null;
  }

  async findFlowTrigger(text, deviceId = null) {
    await this.ensureFresh();
    const value = (text || "").trim();
    if (!value) return null;
    const items = this.filterByDevice(this.cache.flows, deviceId);
    return (
      items.find(
        (flow) =>
          flow.enabled &&
          Array.isArray(flow.triggers) &&
          flow.triggers.some((trigger) => matchesTrigger(value, trigger, "includes"))
      ) || null
    );
  }

  async createCommand(payload) {
    const created = await createCommand(payload, this.logger);
    await this.refresh();
    return created;
  }

  async updateCommand(id, payload) {
    const updated = await updateCommand(id, payload, this.logger);
    await this.refresh();
    return updated;
  }

  async deleteCommand(id) {
    await deleteCommand(id, this.logger);
    await this.refresh();
  }

  async createQuickReply(payload) {
    const created = await createQuickReply(payload, this.logger);
    await this.refresh();
    return created;
  }

  async updateQuickReply(id, payload) {
    const updated = await updateQuickReply(id, payload, this.logger);
    await this.refresh();
    return updated;
  }

  async deleteQuickReply(id) {
    await deleteQuickReply(id, this.logger);
    await this.refresh();
  }

  async createFlow(payload) {
    const created = await createFlow(payload, this.logger);
    await this.refresh();
    return created;
  }

  async updateFlow(id, payload) {
    const updated = await updateFlow(id, payload, this.logger);
    await this.refresh();
    return updated;
  }

  async deleteFlow(id) {
    await deleteFlow(id, this.logger);
    await this.refresh();
  }

  filterByDevice(items, deviceId) {
    if (!deviceId) return items;
    const deviceItems = items.filter((item) => item.deviceId === deviceId);
    const globalItems = items.filter((item) => !item.deviceId);
    return [...deviceItems, ...globalItems];
  }
}
