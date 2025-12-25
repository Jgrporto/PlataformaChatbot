import { criarTesteNewBR } from "../../services/newbrService.js";
import { normalizeToE164BR } from "../../utils/phone.js";
import {
  createAgentCommand,
  deleteAgentCommand,
  listAgentCommands,
  normalizeAgentTrigger,
  updateAgentCommand
} from "../db/repositories/chatbotCommands.js";

const FALLBACK_TEST_MESSAGE = "So um momento! Vou chamar um dos atendentes.";
const LIMIT_TEST_MESSAGE = "Aguarde um momento que um atendente vai falar com voce.";
const USER_PARAM_KEYS = ["username", "user", "login", "name"];
const PASS_PARAM_KEYS = ["password", "pass", "senha"];
const SHORT_HTTP_HOSTS = new Set(["bludx.top"]);

function normalizeHttpHost(value = "") {
  return (value || "").trim().replace(/^www\./i, "").toLowerCase();
}

function isShortHttpLink(link = "") {
  if (!link) return false;
  try {
    const url = new URL(link);
    return SHORT_HTTP_HOSTS.has(normalizeHttpHost(url.hostname));
  } catch {
    return false;
  }
}

function prioritizeShortHttpLinks(links = []) {
  if (!Array.isArray(links)) return [];
  const unique = Array.from(new Set(links.filter(Boolean)));
  if (!unique.length) return unique;
  const shortLinks = unique.filter((link) => isShortHttpLink(link));
  if (!shortLinks.length) return unique;
  const remainder = unique.filter((link) => !shortLinks.includes(link));
  return [...shortLinks, ...remainder];
}

function buildTemplateVariables({
  name = "",
  phone = "",
  usuario = "",
  senha = "",
  http1 = "",
  http2 = ""
}) {
  return {
    nome: (name || "").trim(),
    telefone: (phone || "").trim(),
    usuario: (usuario || "").trim(),
    senha: (senha || "").trim(),
    http1: (http1 || "").trim(),
    http2: (http2 || "").trim()
  };
}

function applyCustomVariables(template = "", customVars = {}) {
  const safeTemplate = template || "";
  if (!customVars || typeof customVars !== "object") return safeTemplate;
  return safeTemplate.replace(/\{#([a-z0-9_]+)\}/gi, (match, keyRaw) => {
    const key = (keyRaw || "").toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(customVars, key)) return match;
    return customVars[key] ?? "";
  });
}

function renderTemplate(template = "", vars = {}, { allowTestVars = false, customVars = {} } = {}) {
  const safeTemplate = template || "";
  const withBuiltins = safeTemplate.replace(
    /\{#(nome|telefone|usuario|senha|http1|http2)\}/gi,
    (match, keyRaw) => {
      const key = (keyRaw || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(customVars, key)) {
        return customVars[key] ?? "";
      }
      if (key === "nome" || key === "telefone") {
        return vars[key] || "";
      }
      if (!allowTestVars) return match;
      return vars[key] || "";
    }
  );
  return applyCustomVariables(withBuiltins, customVars);
}

function extractHttpLinks(text = "") {
  const matches = (text || "").match(/https?:\/\/[^\s<>"']+/gi);
  return matches ? Array.from(new Set(matches)) : [];
}

function sanitizeCredentialValue(value = "") {
  let cleaned = (value || "").trim();
  cleaned = cleaned.replace(/^[*•-]+\s*/, "");
  cleaned = cleaned.replace(/^[=:.-]\s*/, "");
  return cleaned.trim();
}

function pickParamValue(params, keys) {
  if (!params) return "";
  const map = new Map();
  for (const [key, val] of params.entries()) {
    if (map.has(key.toLowerCase())) continue;
    map.set(key.toLowerCase(), val);
  }
  for (const key of keys) {
    const value = map.get(key);
    if (value) return sanitizeCredentialValue(value);
  }
  return "";
}

function parseCredentialsFromQueryString(raw = "") {
  const cleaned = sanitizeCredentialValue(raw);
  if (!cleaned || !cleaned.includes("=")) return { usuario: "", senha: "" };

  let query = cleaned;
  if (cleaned.includes("?")) {
    query = cleaned.split("?").pop() || "";
  }

  const params = new URLSearchParams(query);
  const usuario = pickParamValue(params, USER_PARAM_KEYS);
  const senha = pickParamValue(params, PASS_PARAM_KEYS);
  return { usuario, senha };
}

function extractCredentialsFromText(text = "") {
  const lines = (text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let usuario = "";
  let senha = "";

  for (const line of lines) {
    const cleanLine = line.replace(/[*_]/g, "").trim();

    const queryCreds = parseCredentialsFromQueryString(cleanLine);
    if (!usuario && queryCreds.usuario) usuario = queryCreds.usuario;
    if (!senha && queryCreds.senha) senha = queryCreds.senha;

    if (!usuario) {
      const match = cleanLine.match(/(?:usuario|user|login|username)\s*[:=\-]?\s*(.+)/i);
      if (match) {
        const rawValue = sanitizeCredentialValue(match[1]);
        const parsed = parseCredentialsFromQueryString(rawValue);
        usuario = parsed.usuario || rawValue;
        if (!senha && parsed.senha) senha = parsed.senha;
      }
    }
    if (!senha) {
      const match = cleanLine.match(/(?:senha|password|pass)\s*[:=\-]?\s*(.+)/i);
      if (match) {
        const rawValue = sanitizeCredentialValue(match[1]);
        const parsed = parseCredentialsFromQueryString(rawValue);
        senha = parsed.senha || rawValue;
        if (!usuario && parsed.usuario) usuario = parsed.usuario;
      }
    }
    if (usuario && senha) break;
  }

  return { usuario, senha };
}

function extractCredentialsFromUrls(urls = []) {
  let usuario = "";
  let senha = "";

  for (const raw of urls) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (!usuario) {
        usuario = pickParamValue(url.searchParams, USER_PARAM_KEYS) || "";
      }
      if (!senha) {
        senha = pickParamValue(url.searchParams, PASS_PARAM_KEYS) || "";
      }
    } catch {
      // ignore invalid URLs
    }
    if (usuario && senha) break;
  }

  return { usuario, senha };
}

function detectTestLimit(text = "") {
  if (!text) return false;
  return text.normalize("NFD").toLowerCase().includes("ja solicitou");
}

function resolveAppNameFromTrigger(trigger = "") {
  return trigger.replace(/^#/, "").trim();
}

export class ChatbotCommandsService {
  constructor({ logger, configService } = {}) {
    this.logger = logger;
    this.configService = configService;
  }

  async getCustomVariables(deviceId = null) {
    if (!this.configService?.getVariablesMap) return {};
    try {
      return await this.configService.getVariablesMap(deviceId);
    } catch (err) {
      this.logger?.warn?.("[ChatbotCommands] Falha ao carregar variaveis", err);
      return {};
    }
  }

  async list({ includeDisabled = true, deviceId = null } = {}) {
    return listAgentCommands({ includeDisabled, deviceId }, this.logger);
  }

  async create(payload) {
    const created = await createAgentCommand(payload, this.logger);
    return created;
  }

  async update(id, payload) {
    const updated = await updateAgentCommand(id, payload, this.logger);
    return updated;
  }

  async delete(id) {
    await deleteAgentCommand(id, this.logger);
  }

  async findActiveCommand(trigger, deviceId) {
    const normalized = normalizeAgentTrigger(trigger);
    if (!normalized) return null;
    const commands = await listAgentCommands({ includeDisabled: false, deviceId }, this.logger);
    return commands.find((cmd) => normalizeAgentTrigger(cmd.trigger) === normalized) || null;
  }

  async handleAgentCommand({
    text,
    deviceId,
    devicePhone,
    phone,
    phoneE164,
    name
  }) {
    const normalizedTrigger = normalizeAgentTrigger(text);
    if (!normalizedTrigger) return { handled: false };

    const command = await this.findActiveCommand(normalizedTrigger, deviceId || null);
    if (!command) return { handled: false };

    const customVars = await this.getCustomVariables(deviceId || null);

    const baseVars = buildTemplateVariables({
      name,
      phone: phoneE164 || phone || ""
    });

    if (command.commandType === "reply") {
      const response = renderTemplate(command.responseTemplate, baseVars, {
        allowTestVars: false,
        customVars
      });
      return { handled: true, response, commandType: command.commandType };
    }

    const clientWhatsappE164 = normalizeToE164BR(phoneE164 || phone || "");
    if (!clientWhatsappE164) {
      return { handled: true, response: FALLBACK_TEST_MESSAGE, commandType: command.commandType };
    }

    const appName = resolveAppNameFromTrigger(command.trigger);
    let replyText = "";

    try {
      replyText = await criarTesteNewBR({
        appName,
        devicePhone: devicePhone || "",
        clientName: (name || "").trim(),
        clientWhatsappE164,
        flowLabel: appName,
        deviceId
      });
    } catch (err) {
      this.logger?.error?.("[ChatbotCommands] Falha ao chamar NewBR", err);
      return { handled: true, response: FALLBACK_TEST_MESSAGE, commandType: command.commandType };
    }

    if (detectTestLimit(replyText)) {
      return { handled: true, response: LIMIT_TEST_MESSAGE, commandType: command.commandType, scheduleFollowUp: false };
    }

    const httpLinks = extractHttpLinks(replyText);
    const prioritizedHttpLinks = prioritizeShortHttpLinks(httpLinks);
    const textCreds = extractCredentialsFromText(replyText);
    const urlCreds = extractCredentialsFromUrls(httpLinks);
    const usuario = textCreds.usuario || urlCreds.usuario || "";
    const senha = textCreds.senha || urlCreds.senha || "";

    const vars = buildTemplateVariables({
      name,
      phone: clientWhatsappE164,
      usuario,
      senha,
      http1: prioritizedHttpLinks[0] || "",
      http2: prioritizedHttpLinks[1] || ""
    });

    const response = renderTemplate(command.responseTemplate, vars, {
      allowTestVars: true,
      customVars
    });
    return { handled: true, response, commandType: command.commandType, scheduleFollowUp: true };
  }
}
