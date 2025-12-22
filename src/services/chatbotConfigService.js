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

  async getCommands({ includeDisabled = true } = {}) {
    await this.ensureFresh();
    return includeDisabled ? this.cache.commands : this.cache.commands.filter((c) => c.enabled);
  }

  async getQuickReplies({ includeDisabled = true } = {}) {
    await this.ensureFresh();
    return includeDisabled
      ? this.cache.quickReplies
      : this.cache.quickReplies.filter((q) => q.enabled);
  }

  async getFlows({ includeDisabled = true } = {}) {
    await this.ensureFresh();
    return includeDisabled ? this.cache.flows : this.cache.flows.filter((f) => f.enabled);
  }

  async getCommandIndex() {
    const commands = await this.getCommands({ includeDisabled: true });
    const activeByToken = new Map();
    const tokensAll = [];
    for (const cmd of commands) {
      const token = normalizeToken(cmd.token);
      tokensAll.push(token);
      if (cmd.enabled) activeByToken.set(token, { ...cmd, token });
    }
    return { items: commands, activeByToken, tokensAll };
  }

  async findQuickReply(text) {
    await this.ensureFresh();
    const value = (text || "").trim();
    if (!value) return null;
    return (
      this.cache.quickReplies.find((item) => item.enabled && matchesTrigger(value, item.trigger, item.matchType)) ||
      null
    );
  }

  async findFlowTrigger(text) {
    await this.ensureFresh();
    const value = (text || "").trim();
    if (!value) return null;
    return (
      this.cache.flows.find(
        (flow) =>
          flow.enabled &&
          Array.isArray(flow.triggers) &&
          flow.triggers.some((trigger) => matchesTrigger(value, trigger, "includes"))
      ) ||
      null
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
}
