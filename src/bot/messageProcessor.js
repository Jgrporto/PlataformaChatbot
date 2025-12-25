import Tesseract from "tesseract.js";
import { criarUsuarioGerenciaAppComM3u } from "../../gerenciaApp.js";
import { normalizeToE164BR } from "../../utils/phone.js";
import { extractMacFromImageBuffer, extractMacFromText } from "../../services/ocrService.js";
import { criarTesteNewBR } from "../../services/newbrService.js";
import { logger as defaultLogger } from "../../utils/logger.js";

const DEVICE_PHONE = process.env.DEVICE_PHONE || "5524999162165";
const KEYWORD_ASSIST = "ASSIST PLUS";
const KEYWORD_LAZER = "LAZER PLAY";
const KEYWORD_FUN = "FUN PLAY";
const KEYWORD_PLAYSIM = "PLAYSIM";
const INSTRUCAO_TRIGGER = "VOCE VAI BAIXAR O APLICATIVO, INSTALAR E ABRIR";
const INSTRUCAO_TRIGGER_2 = "ASSIM QUE ABRIR ME MANDA UM PRINT DO APLICATIVO ABERTO";
const LAZER_INSTRUCAO_TRIGGER = "CHEGANDO NESSA TELA VOCE ME AVISA AQUI";
const LAZER_INSTRUCAO_TRIGGER_PLAYLIST = "ASSIM QUE BAIXAR, CLICA NA OPCAO PLAYLIST E ME MANDA UMA FOTO";
const MSG_INSTRUCAO_CELULAR =
  "Voce vai baixar o aplicativo, instalar e abrir.\n\nAssim que abrir me manda um print do aplicativo aberto";
const MSG_PEDIR_PRINT =
  "Preciso do print do app aberto para liberar o teste. Pode me enviar a imagem da tela aberta, por favor?";
const MSG_TESTE_ATIVO = "Aguarde um momento que um atendente vai falar com voce.";
const MSG_TESTE_IBO_OK = "Seu teste foi gerado! Fecha o app e abre novamente.";
const MSG_OCR_FALHA_AGUARDANDO_AGENTE =
  "Ah sim! So um momento, vou ativar o seu teste aqui no sistema.\n" +
  "Nao consegui achar o MAC na imagem, um atendente vai te responder agora.";

const APP_PROFILES = {
  ASSIST: {
    keyword: KEYWORD_ASSIST,
    appName: "assist",
    display: "ASSIST PLUS",
    code: "centertv",
    fallbackFullText: true
  },
  LAZER: { keyword: KEYWORD_LAZER, appName: "lazer play", display: "LAZER PLAY", code: "br99" },
  FUN: { keyword: KEYWORD_LAZER, appName: "lazer play", display: "FUN PLAY", code: "br99" },
  PLAYSIM: {
    keyword: KEYWORD_ASSIST,
    appName: "playsim",
    display: "PLAYSIM",
    code: "centertv",
    fallbackFullText: true
  }
};

const DEFAULT_COMMANDS = [
  { token: "#IBO", flow: "IBO", enabled: true },
  { token: "#ASSIST", flow: "ASSIST", enabled: true },
  { token: "#LAZER", flow: "LAZER", enabled: true },
  { token: "#FUN", flow: "FUN", enabled: true },
  { token: "#PLAYSIM", flow: "PLAYSIM", enabled: true }
];

function normalizeInstrucao(str) {
  return (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function isInstrucaoMensagem(texto) {
  const norm = normalizeInstrucao(texto);
  return norm.includes(INSTRUCAO_TRIGGER) || norm.includes(INSTRUCAO_TRIGGER_2);
}

function isInstrucaoLazer(texto) {
  const norm = normalizeInstrucao(texto);
  return norm.includes(LAZER_INSTRUCAO_TRIGGER) || norm.includes(LAZER_INSTRUCAO_TRIGGER_PLAYLIST);
}

function makeLogger(deps) {
  return deps?.logger || defaultLogger;
}

export function createSessionState() {
  return {
    aguardandoMac: new Set(),
    aguardandoMacAgente: new Map(),
    fluxoCelular: new Map(),
    fluxoLazer: new Map(),
    customFlows: new Map()
  };
}

export function createSessionCache() {
  return {
    botSentMessageIds: new Set(),
    botSentFingerprints: new Map(),
    agentProcessedMessageIds: new Set(),
    chatIdPhoneCache: new Map()
  };
}

export function createMessageProcessor(deps = {}) {
  const logger = makeLogger(deps);

  function touchActivity() {
    if (deps.onActivity) deps.onActivity();
  }

  function markBotSent(session, chatId, body) {
    if (!chatId) return;
    const text = (body || "").trim();
    const key = `${chatId}|${text}`;
    session.cache.botSentFingerprints.set(key, Date.now() + 15000);
  }

  function getSerializedMessageId(msg) {
    return msg?.id?._serialized || "";
  }

  function resolveTipoContato(chat, chatId) {
    return !!chat?.isGroup || (chatId || "").endsWith("@g.us") ? "GRUPO" : "CONTATO";
  }

  function formatConteudoParaLog(msg) {
    const body = (msg?.body || "").trim();
    const type = (msg?.type || "").toString().toLowerCase();
    const looksLikeMedia =
      !!msg?.hasMedia ||
      ["image", "video", "audio", "ptt", "document", "sticker"].includes(type) ||
      !!msg?._data?.isMedia;

    if (looksLikeMedia) {
      const tipo = (msg?.type || "MIDIA").toString().toUpperCase();
      const mime = msg?._data?.mimetype || msg?._data?.mimeType || "";
      const mimeTag = mime ? ` mimetype=${mime}` : "";
      return body ? `[MIDIA:${tipo}${mimeTag}] ${body}` : `[MIDIA:${tipo}${mimeTag}]`;
    }
    return body || "<sem texto>";
  }

  function resolveNome(contact, chat, phone) {
    return (
      contact?.verifiedName ||
      contact?.pushname ||
      contact?.name ||
      contact?.shortName ||
      chat?.name ||
      contact?.businessProfile?.tag ||
      ""
    );
  }

  function applyCustomVariables(template = "", variables = {}) {
    const safeTemplate = template || "";
    if (!variables || typeof variables !== "object") return safeTemplate;
    return safeTemplate.replace(/\{#([a-z0-9_]+)\}/gi, (match, keyRaw) => {
      const key = (keyRaw || "").toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(variables, key)) return match;
      return variables[key] ?? "";
    });
  }

  function renderTemplateWithVariables(template, { name, phone, variables = {} }) {
    const value = template || "";
    if (!value) return value;
    const withBuiltins = value.replace(/\{#(nome|telefone)\}/gi, (match, keyRaw) => {
      const key = (keyRaw || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(variables, key)) {
        return variables[key] ?? "";
      }
      if (key === "nome") return (name || "").trim();
      if (key === "telefone") return (phone || "").trim();
      return match;
    });
    return applyCustomVariables(withBuiltins, variables);
  }

  function renderQuickReplyTemplate(template, { name, phone, variables = {} }) {
    return renderTemplateWithVariables(template, { name, phone, variables });
  }

  function findValidPhoneDigits(candidates = []) {
    for (const candidate of candidates) {
      const digits = extractPhoneFromText(candidate);
      if (digits) return digits;
    }
    return "";
  }

  function extractPhoneFromText(text) {
    const raw = (text || "").toString().trim();
    if (!raw) return "";

    const matches = raw.match(/(\+?\d[\d\s().-]{8,}\d)/g);
    if (matches) {
      for (const match of matches) {
        const digits = cleanPhone(match);
        if (normalizeToE164BR(digits)) return digits;
      }
    }

    const digits = cleanPhone(raw);
    if (normalizeToE164BR(digits)) return digits;
    return "";
  }

  function findPhoneFromDisplayName(contact, chat, msg) {
    const nameCandidates = [
      contact?.verifiedName,
      contact?.pushname,
      contact?.name,
      contact?.shortName,
      msg?._data?.notifyName,
      msg?._data?.sender?.pushname
    ];

    if (!chat?.isGroup) {
      nameCandidates.push(chat?.name);
    }

    return findValidPhoneDigits(nameCandidates);
  }

  function resolvePhone(contact, msg, chat) {
    const chatId = chat?.id?._serialized || "";
    const chatUser = chat?.id?.user || "";
    const isSelfContact = !!contact?.isMe;
    const contactNumber = isSelfContact ? "" : contact?.number;
    const contactUser = isSelfContact ? "" : contact?.id?.user || "";
    const contactId = isSelfContact ? "" : contact?.id?._serialized || "";
    const msgAuthor = msg?.author || "";

    if (msg?.fromMe) {
      const candidates = [
        msg?.to,
        chatId,
        chatUser,
        contactNumber,
        contactUser,
        contactId,
        msgAuthor
      ];
      const fromCandidates = findValidPhoneDigits(candidates);
      if (fromCandidates) return fromCandidates;
      return findPhoneFromDisplayName(contact, chat, msg);
    }

    const candidates = [
      contactNumber,
      contactUser,
      contactId,
      chatUser,
      chatId,
      msg?.from,
      msgAuthor
    ];
    const fromCandidates = findValidPhoneDigits(candidates);
    if (fromCandidates) return fromCandidates;
    return findPhoneFromDisplayName(contact, chat, msg);
  }

  function resolveAppName(appEscolhido = "") {
    const app = (appEscolhido || "").trim();
    if (!app) return "com.whatsapp";
    const lower = app.toLowerCase();
    if (lower.includes("assist")) return "assist";
    if (lower.includes("lazer")) return "lazer play";
    if (lower.includes("fun")) return "fun play";
    if (lower.includes("playsim")) return "playsim";
    if (lower.includes("ibo")) return "ibo revenda";
    if (lower.includes("celular")) return "celular";
    return lower;
  }

  function nomeSeguro(nome, phone) {
    const n = (nome || "").trim();
    return n || phone || "Cliente";
  }

  function resolveChatIdConversa(msg) {
    return msg?.fromMe ? msg?.to : msg?.from;
  }

  function resolveTargetChatId(msg, chat) {
    if (msg?.fromMe) {
      return msg?.to || chat?.id?._serialized || "";
    }
    return msg?.from || chat?.id?._serialized || "";
  }

  function cleanPhone(raw) {
    return (raw || "").replace(/[^\d]/g, "");
  }

  function extrairM3u(texto) {
    if (!texto) return null;

    const m3uRegex =
      /(https?:\/\/[^\s]+\/get\.php[^\s]+)|((?:http|https):\/\/[^\s]+\/get\.php\?username=[^\s&]+&password=[^\s&]+&type=m3u[^\s]*)/i;
    const match = texto.match(m3uRegex);
    return match ? match[0] : null;
  }

  function filtrarBloco(texto, keyword) {
    if (!texto) return null;

    const linhas = texto.split(/\r?\n/).map((l) => l.trim());
    const keywordRegex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");

    const blocos = [];
    let blocoAtual = [];
    let encontrado = false;

    for (const linha of linhas) {
      if (!linha) continue;
      if (keywordRegex.test(linha)) {
        encontrado = true;
        if (blocoAtual.length) {
          blocos.push(blocoAtual.join("\n"));
          blocoAtual = [];
        }
      }
      if (encontrado) blocoAtual.push(linha);
      if (encontrado && linha.endsWith("***")) {
        blocos.push(blocoAtual.join("\n"));
        blocoAtual = [];
      }
    }

    if (blocoAtual.length) blocos.push(blocoAtual.join("\n"));

    if (!blocos.length) return null;

    const keywordLower = keyword.toLowerCase();
    const encontrou = blocos.find((b) => b.toLowerCase().includes(keywordLower));
    return encontrou || blocos[0];
  }

  function extrairUsuarioDoM3u(m3uUrl) {
    if (!m3uUrl) return null;

    const paramMatch = m3uUrl.match(/username=([^&]+)/i);
    if (paramMatch) return decodeURIComponent(paramMatch[1]);

    const pathMatch = m3uUrl.match(/\/([A-Za-z0-9._-]{3,})\/[A-Za-z0-9._-]{3,}\/?$/);
    return pathMatch ? pathMatch[1] : null;
  }

  function extrairMacDeTexto(texto) {
    return extractMacFromText(texto);
  }

  async function lerTextoDaImagem(msg) {
    if (!msg.hasMedia) return { ok: false, texto: "" };

    const media = await msg.downloadMedia();
    if (!media?.data) return { ok: false, texto: "" };

    const buffer = Buffer.from(media.data, "base64");
    const ocr = await Tesseract.recognize(buffer, "eng").catch((err) => {
      logger.error("Falha no OCR (texto geral)", err);
      return null;
    });

    const texto = ocr?.data?.text || "";
    return { ok: !!texto.trim(), texto };
  }

  function buildOcrTextLog(extractedText) {
    const cleaned = (extractedText || "").replace(/\s+/g, " ").trim();
    const logFull = (process.env.OCR_LOG_FULL_TEXT || "0") === "1";
    const text = logFull ? cleaned : cleaned.slice(0, 200);
    return { text, textLen: cleaned.length, logFull };
  }

  async function lerMacDaImagem(msg) {
    if (!msg.hasMedia) return { ok: false, reason: "Mensagem nao possui midia" };

    const msgId = msg?.id?._serialized || "";
    const mime = msg?._data?.mimetype || msg?._data?.mimeType || "";
    const downloadStart = Date.now();
    logger.info(`[OCR] Download midia inicio (msgId=${msgId} mime=${mime || "n/a"})`);
    const media = await msg.downloadMedia();
    const downloadMs = Date.now() - downloadStart;

    if (!media?.data) {
      logger.warn(`[OCR] Download midia sem dados (msgId=${msgId} ms=${downloadMs})`);
      return { ok: false, reason: "Falha ao baixar a midia" };
    }

    const buffer = Buffer.from(media.data, "base64");
    const bufferBytes = buffer.length;
    logger.info(`[OCR] Download midia fim (msgId=${msgId} ms=${downloadMs} bytes=${bufferBytes})`);

    const ocrStart = Date.now();
    const slowMs = Number(process.env.OCR_SLOW_LOG_MS || 60000);
    let slowTimer = null;
    if (slowMs > 0) {
      slowTimer = setTimeout(() => {
        const elapsed = Date.now() - ocrStart;
        logger.warn(`[OCR] OCR ainda em andamento (msgId=${msgId} ms=${elapsed})`);
      }, slowMs);
    }

    let result;
    try {
      logger.info(`[OCR] OCR inicio (msgId=${msgId} bytes=${bufferBytes})`);
      result = await extractMacFromImageBuffer(buffer);
    } finally {
      if (slowTimer) clearTimeout(slowTimer);
    }

    const ocrMs = Date.now() - ocrStart;
    logger.info(
      `[OCR] OCR fim (msgId=${msgId} ms=${ocrMs} ok=${result?.ok ? "1" : "0"} errorType=${result?.errorType || "n/a"} usedFallback=${result?.usedFallback ? "1" : "0"} rotateAuto=${result?.usedRotateAuto ? "1" : "0"})`
    );

    if (result.ok) {
      return {
        ok: true,
        mac: result.mac,
        reason: "",
        errorType: null,
        extractedText: result.extractedText || ""
      };
    }

    return {
      ok: false,
      mac: null,
      reason: result.details || "",
      errorType: result.errorType || "OCR_ERROR",
      extractedText: result.extractedText || "",
      err: result.err
    };
  }

  function resolveNomeNewBR(contact, phoneDigits = "") {
    const candidate = contact?.verifiedName || contact?.pushname || contact?.name || "";

    const nome = (candidate || "").trim();
    if (!nome) return "";

    const digits = (nome || "").replace(/[^\d]/g, "");
    if (digits && phoneDigits && digits === phoneDigits) return "";
    return nome;
  }

  function buildFlowLabel(appEscolhido, mac) {
    const appName = resolveAppName(appEscolhido);
    if (mac && appName === "ibo revenda") return `${appName} - MAC ${mac}`;
    return appName;
  }

  async function gerarTeste(clientePhoneDigits, clientName, appEscolhido = "", mac, devicePhoneOverride) {
    const phoneDigits = cleanPhone(clientePhoneDigits);
    const whatsappE164 = normalizeToE164BR(phoneDigits);
    const appName = resolveAppName(appEscolhido);
    const devicePhone = devicePhoneOverride || DEVICE_PHONE;

    if (!whatsappE164) {
      throw new Error(`WhatsApp invalido para E.164: "${clientePhoneDigits}"`);
    }

    return criarTesteNewBR({
      appName,
      devicePhone,
      clientName: (clientName || "").trim() || "",
      clientWhatsappE164: whatsappE164,
      flowLabel: buildFlowLabel(appName, mac),
      deviceId: deps.deviceId || null
    });
  }

  async function gerarTesteSeguro(cliente, nome = "", appEscolhido = "", mac, devicePhoneOverride) {
    try {
      return await gerarTeste(cliente, nome, appEscolhido, mac, devicePhoneOverride);
    } catch (err) {
      logger.error("[Teste] Falha ao gerar teste", err);
      return null;
    }
  }

  function detectouLimite(texto) {
    if (!texto) return false;
    const normalizado = texto.normalize("NFD").toLowerCase();
    return normalizado.includes("ja solicitou");
  }

  function extrairCredenciais(bloco) {
    if (!bloco) return {};
    const lines = bloco.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let codigo, usuario, senha;

    for (const line of lines) {
      const cleanLine = line.replace(/[*_]/g, "");
      if (!codigo) {
        const mCod = cleanLine.match(/cod(?:igo)?[:=\-]?\s*([^\s]+)/i);
        if (mCod) codigo = mCod[1];
      }
      if (!usuario) {
        const mUser = cleanLine.match(/(?:usuario|usuario|user|login)[:=\-]?\s*(.+)/i);
        if (mUser) usuario = mUser[1].trim();
      }
      if (!senha) {
        const mPass = cleanLine.match(/(?:senha|password|pass)[:=\-]?\s*(.+)/i);
        if (mPass) senha = mPass[1].trim();
      }
    }
    return { codigo, usuario, senha };
  }

  function escapeRegex(value) {
    return (value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function getCommandIndex() {
    if (deps.configService?.getCommandIndex) {
      return deps.configService.getCommandIndex(deps.deviceId || null);
    }
    const items = DEFAULT_COMMANDS.map((cmd, index) => ({ id: index + 1, ...cmd }));
    const activeByToken = new Map();
    const tokensAll = [];
    for (const cmd of items) {
      const token = (cmd.token || "").trim().toUpperCase();
      tokensAll.push(token);
      if (cmd.enabled) activeByToken.set(token, { ...cmd, token });
    }
    return { items, activeByToken, tokensAll };
  }

  async function getCustomVariablesMap() {
    if (!deps.configService?.getVariablesMap) return {};
    try {
      return await deps.configService.getVariablesMap(deps.deviceId || null);
    } catch (err) {
      logger.warn("[Variaveis] Falha ao carregar mapa", err);
      return {};
    }
  }

  async function responderComTeste(session, msg, phone, nome, profile, mac) {
    const { keyword, appName, display, code: defaultCode } = profile;
    const reply = await gerarTesteSeguro(phone, nome, appName, mac, session?.devicePhone);
    if (!reply) {
      await replyBot(session, msg, phone, nome, "So um momento! Vou chamar um dos atendentes.");
      return;
    }

    if (detectouLimite(reply)) {
      await replyBot(session, msg, phone, nome, MSG_TESTE_ATIVO);
      return;
    }

    const commandIndex = await getCommandIndex();
    const commandTokens = commandIndex.tokensAll || [];

    let filtrado = filtrarBloco(reply, keyword);

    if (!filtrado) {
      if (profile?.fallbackFullText && reply) {
        const credFallback = extrairCredenciais(reply);
        const codigoFallback = defaultCode || credFallback.codigo;
        if (credFallback.usuario || credFallback.senha || codigoFallback) {
          const partes = [display, ""];
          if (codigoFallback) partes.push(`Cod: ${codigoFallback}`);
          if (credFallback.usuario) partes.push(`Usuario: ${credFallback.usuario}`);
          if (credFallback.senha) partes.push(`Senha: ${credFallback.senha}`);
          await replyBot(session, msg, phone, nome, partes.join("\n"));
          return;
        }
      }
      await replyBot(session, msg, phone, nome, `Nao encontrei conteudo para ${keyword}.`);
      return;
    }

    const keywordRegex = new RegExp(keyword, "gi");
    const tokenPattern = commandTokens.filter(Boolean).map(escapeRegex).join("|");
    const comandosRegex = tokenPattern ? new RegExp(tokenPattern, "gi") : null;
    filtrado = filtrado.replace(keywordRegex, "");
    if (comandosRegex) filtrado = filtrado.replace(comandosRegex, "");
    filtrado = filtrado.trim();

    const cred = extrairCredenciais(filtrado);
    const codigoFinal = defaultCode || cred.codigo;

    if (cred.usuario || cred.senha || codigoFinal) {
      const partes = [display, ""];
      if (codigoFinal) partes.push(`Cod: ${codigoFinal}`);
      if (cred.usuario) partes.push(`Usuario: ${cred.usuario}`);
      if (cred.senha) partes.push(`Senha: ${cred.senha}`);
      await replyBot(session, msg, phone, nome, partes.join("\n"));
    } else {
      await replyBot(session, msg, phone, nome, filtrado);
    }

    const chatId = resolveChatIdConversa(msg);
    const phoneE164 = normalizeToE164BR(phone);
    if (chatId && phoneE164) {
      deps.followUpService?.schedule({
        clientPhone: phoneE164,
        chatId,
        createdAt: new Date().toISOString(),
        clientName: nome,
        sessionName: session?.name || "",
        deviceId: deps.deviceId || null
      });
    }
  }

  async function iniciarTesteIbo(session, mac, msg, phone, nome) {
    const reply = await gerarTesteSeguro(phone, nome, "IBO", mac, session?.devicePhone);
    if (!reply) {
      await replyBot(session, msg, phone, nome, "So um momento! Vou chamar um dos atendentes.");
      return;
    }

    if (detectouLimite(reply)) {
      await replyBot(session, msg, phone, nome, MSG_TESTE_ATIVO);
      return;
    }

    const m3u = extrairM3u(reply);
    if (!m3u) {
      logger.warn("[IBO] Nao foi possivel extrair M3U do teste.");
      await replyBot(session, msg, phone, nome, MSG_TESTE_IBO_OK);
      return;
    }

    const username = extrairUsuarioDoM3u(m3u) || nome || phone;
    const serverName = `TVAUTO ${username || "Cliente"}`;
    const observacoes = `Teste Gerado via Chatbot\nMAC: ${mac}`;

    try {
      await criarUsuarioGerenciaAppComM3u(m3u, {
        mac,
        serverName,
        app: "IBO REVENDA",
        nome,
        whatsapp: phone,
        observacoes,
        minimalFields: true
      });
      logger.info(`[IBO] Cadastro GerenciaApp OK para ${phone} (${serverName})`);
    } catch (err) {
      logger.error("[IBO] Falha ao cadastrar no GerenciaApp", err);
    }

    await replyBot(session, msg, phone, nome, MSG_TESTE_IBO_OK);
  }

  async function handleIboImagem(session, msg, phone, nome) {
    const leitura = await lerMacDaImagem(msg);
    if (leitura.ok && leitura.mac) {
      logger.info(`[IBO] MAC detectado em imagem: ${leitura.mac}`);
      await iniciarTesteIbo(session, leitura.mac, msg, phone, nome);
      return { handled: true, ocr: leitura };
    }

    if (leitura?.errorType) {
      logger.warn(`[IBO] OCR falhou: ${leitura.errorType} ${leitura.reason || ""}`);
    }

    return { handled: false, ocr: leitura };
  }

  async function handleIboMensagemMarcada(session, msg, phone, nome) {
    if (!msg.hasQuotedMsg) return { handled: false };

    const quoted = await msg.getQuotedMessage().catch(() => null);
    if (!quoted?.hasMedia) return { handled: false };

    const leitura = await lerMacDaImagem(quoted);
    if (leitura.ok && leitura.mac) {
      logger.info(`[IBO] MAC detectado em midia marcada: ${leitura.mac}`);
      await iniciarTesteIbo(session, leitura.mac, msg, phone, nome);
      return { handled: true, ocr: leitura };
    }

    return { handled: false, ocr: leitura };
  }

  function textoSim(textoLower) {
    const termos = ["sim", "ok", "positivo", "isso", "isso mesmo", "certo", "correto", "beleza", "ja"];
    return termos.some((k) => {
      const re = new RegExp(`\\b${k}\\b`, "i");
      return re.test(textoLower);
    });
  }

  function textoNao(textoLower) {
    const termos = [
      "nao",
      "n",
      "negativo",
      "nao quero",
      "nao obrigado",
      "n obrigado",
      "n quero",
      "nao quero mais",
      "nao consegui"
    ];
    return termos.some((k) => {
      const re = new RegExp(`\\b${k}\\b`, "i");
      return re.test(textoLower);
    });
  }

  function textoConfirmacaoLazer(textoLower) {
    const termos = ["consegui", "baixei", "abri", "abri agora", "abri o app", "abri o aplicativo", "sim"];
    return termos.some((k) => {
      const re = new RegExp(`\\b${k}\\b`, "i");
      return re.test(textoLower);
    });
  }

  async function concluirFluxoCelular(session, msg, phone, nome, macFromMedia) {
    const estado = session.state.fluxoCelular.get(phone) || {};
    const mac = macFromMedia || estado.mac;

    if (!mac) {
      session.state.fluxoCelular.set(phone, {
        ...estado,
        mac: null,
        stage: "aguardando_prova",
        confirming: false,
        printReminderSent: true
      });
      await replyBot(
        session,
        msg,
        phone,
        nome,
        "Preciso de uma foto com o MAC visivel para liberar. Envie a imagem do app aberto, por favor."
      );
      return;
    }

    const reply = await gerarTesteSeguro(phone, nome, "CELULAR", undefined, session?.devicePhone);
    if (!reply) {
      await replyBot(session, msg, phone, nome, "So um momento! Vou chamar um dos atendentes.");
      return;
    }
    if (detectouLimite(reply)) {
      session.state.fluxoCelular.delete(phone);
      await replyBot(session, msg, phone, nome, MSG_TESTE_ATIVO);
      return;
    }

    const m3u = extrairM3u(reply);
    if (!m3u) {
      logger.warn("[CELULAR] Nao foi possivel extrair M3U do teste para cadastro.");
      await replyBot(session, msg, phone, nome, "Seu teste foi gerado! Fecha o app e abre novamente.");

      const chatId = resolveChatIdConversa(msg);
      const phoneE164 = normalizeToE164BR(phone);
      if (chatId && phoneE164) {
        deps.followUpService?.schedule({
          clientPhone: phoneE164,
          chatId,
          createdAt: new Date().toISOString(),
          clientName: nome,
          sessionName: session?.name || "",
          deviceId: deps.deviceId || null
        });
      }
      return;
    }

    const username = extrairUsuarioDoM3u(m3u) || nome || phone;
    const serverName = `TVAUTO ${username || "Cliente"}`;
    const observacoes = `Teste Gerado via Chatbot\nMAC: ${mac}`;

    try {
      await criarUsuarioGerenciaAppComM3u(m3u, {
        mac,
        serverName,
        app: "IBO REVENDA",
        nome,
        whatsapp: phone,
        observacoes,
        minimalFields: true
      });
      logger.info(`[CELULAR] Cadastro GerenciaApp OK para ${phone} (${serverName})`);
    } catch (err) {
      logger.error("[CELULAR] Falha ao cadastrar no GerenciaApp", err);
    } finally {
      session.state.fluxoCelular.delete(phone);
    }

    await replyBot(session, msg, phone, nome, "Seu teste foi gerado! Fecha o app e abre novamente.");
    const chatId = resolveChatIdConversa(msg);
    const phoneE164 = normalizeToE164BR(phone);
    if (chatId && phoneE164) {
      deps.followUpService?.schedule({
        clientPhone: phoneE164,
        chatId,
        createdAt: new Date().toISOString(),
        clientName: nome,
        sessionName: session?.name || "",
        deviceId: deps.deviceId || null
      });
    }
  }

  async function handleFluxoCelular(session, msg, phone, nome, textoLower) {
    const estado = session.state.fluxoCelular.get(phone);

    if (!estado) return false;

    if (estado?.confirming) {
      if (textoSim(textoLower)) {
        session.state.fluxoCelular.set(phone, { ...estado, confirming: false });
        if (estado.stage === "aguardando_prova") {
          await replyBot(session, msg, phone, nome, MSG_PEDIR_PRINT);
        }
        return true;
      }
      if (textoNao(textoLower)) {
        session.state.fluxoCelular.delete(phone);
        await replyBot(session, msg, phone, nome, "Um atendente vai responder em instantes. Obrigado!");
        return true;
      }
      return false;
    }

    if (estado.stage === "aguardando_prova") {
      if (!estado.printReminderSent) {
        session.state.fluxoCelular.set(phone, { ...estado, printReminderSent: true });
        await replyBot(session, msg, phone, nome, MSG_PEDIR_PRINT);
      }
      return true;
    }

    return false;
  }

  async function handleFluxoLazerImagem(session, msg, phone, nome) {
    const leitura = await lerTextoDaImagem(msg);
    if (!leitura.ok) {
      await replyBot(
        session,
        msg,
        phone,
        nome,
        "Nao consegui ler a imagem. Envie uma foto mais nitida da tela da TV, por favor."
      );
      return true;
    }

    const textoUpper = (leitura.texto || "").toUpperCase();
    const hasPlaylist = textoUpper.includes("PLAYLIST");
    const hasLista = textoUpper.includes("LISTA");
    const hasCodigo = textoUpper.includes("CODIGO") || textoUpper.includes("CODE");

    if ((hasPlaylist || hasLista) && !hasCodigo) {
      session.state.fluxoLazer.set(phone, { stage: "aguardando_playlist_click" });
      await replyBot(
        session,
        msg,
        phone,
        nome,
        "Aperta na opcao Playlist/Lista e me envia a tela seguinte para liberar o teste."
      );
      return true;
    }

    if ((hasPlaylist || hasLista) && hasCodigo) {
      session.state.fluxoLazer.delete(phone);
      await replyBot(session, msg, phone, nome, "Gerando o teste. Use o codigo enviado para preencher no app.");
      await responderComTeste(session, msg, phone, nome, APP_PROFILES.LAZER);
      return true;
    }

    if (hasCodigo) {
      session.state.fluxoLazer.delete(phone);
      await responderComTeste(session, msg, phone, nome, APP_PROFILES.LAZER);
      return true;
    }

    await replyBot(
      session,
      msg,
      phone,
      nome,
      "Preciso da tela do app (menu ou tela de adicionar lista). Envie uma foto nitida, por favor."
    );
    return true;
  }

  async function handleFluxoLazerMensagem(session, msg, phone, textoLower) {
    const estado = session.state.fluxoLazer.get(phone);
    if (!estado) return false;

    if (estado.stage === "aguardando_playlist_click") {
      await replyBot(session, msg, phone, "", "Clica na opcao Playlist e me envia a tela seguinte, por favor.");
      return true;
    }

    if (textoConfirmacaoLazer(textoLower)) {
      await replyBot(session, msg, phone, "", "Beleza! Me envia uma foto da tela da TV para seguirmos o fluxo.");
    } else {
      await replyBot(session, msg, phone, "", "So um momento que ja te respondo, por favor.");
    }

    return true;
  }

  async function iniciarFluxoLazer(session, msg, phone) {
    session.state.fluxoLazer.set(phone, { stage: "aguardando_foto" });
    const nome = msg
      ? resolveNome(await msg.getContact().catch(() => null), await msg.getChat().catch(() => null), phone)
      : phone;
    logFluxoIdentificado("LAZER", phone, nome || phone);
    if (msg) {
      await replyBot(session, msg, phone, "", "Vamos seguir. Envie uma foto da tela da TV do app para continuar.");
    }
  }

  function logFluxoIdentificado(tipo, phone, nome) {
    const safeTipo = (tipo || "N/A").toUpperCase();
    logger.info(
      `FLUXO IDENTIFICADO (${safeTipo}) AGUARDANDO INSTRUCOES DO CLIENTE - ${phone} (${nome || "Cliente"})`
    );
  }

  async function replyBot(session, msg, phoneDigits, nome, texto) {
    const chatId = resolveChatIdConversa(msg) || "";
    markBotSent(session, chatId, texto);
    const ctx = {
      contactType: resolveTipoContato(null, chatId),
      name: (nome || "").trim(),
      phoneE164: normalizeToE164BR(phoneDigits) || "",
      chatId,
      origin: "BOT",
      sessionName: session?.name || ""
    };

    try {
      const sent = await msg.reply(texto);
      const id = sent?.id?._serialized;
      if (id) session.cache.botSentMessageIds.add(id);
      logger.messageSent(ctx, texto);
      await logMessageEvent({
        deviceId: deps.deviceId,
        phone: ctx.phoneE164,
        chatId,
        origin: ctx.origin,
        direction: "out",
        messageType: msg?.type || "text",
        content: texto
      });
      await logInteractionEvent({
        deviceId: deps.deviceId,
        phone: ctx.phoneE164,
        name: ctx.name,
        contactType: ctx.contactType,
        origin: ctx.origin,
        eventType: "message_sent",
        content: texto
      });
      return sent;
    } catch (err) {
      logger.messageSent(ctx, texto, { error: { type: "SEND_ERROR", details: err?.message, err } });
      await logInteractionEvent({
        deviceId: deps.deviceId,
        phone: ctx.phoneE164,
        name: ctx.name,
        contactType: ctx.contactType,
        origin: ctx.origin,
        eventType: "message_sent",
        content: texto,
        errorType: "SEND_ERROR",
        errorDetails: err?.message || "send failed"
      });
      throw err;
    }
  }

  async function processAgentMessage(session, msg) {
    const corpo = (msg?.body || "").trim();
    const corpoUpper = corpo.toUpperCase();
    const chat = await msg.getChat().catch(() => null);
    const targetChatId = resolveTargetChatId(msg, chat);
    const isGroup = !!chat?.isGroup || targetChatId.endsWith("@g.us");

    const targetContact = targetChatId
      ? await session.client.getContactById(targetChatId).catch(() => null)
      : null;

    let phone = "";
    let phoneE164 = "";

    if (msg?.hasQuotedMsg) {
      const quoted = await msg.getQuotedMessage().catch(() => null);
      if (quoted) {
        const quotedContact = await quoted.getContact().catch(() => null);
        const quotedChat = await quoted.getChat().catch(() => null);
        const quotedPhone = resolvePhone(quotedContact, quoted, quotedChat);
        if (normalizeToE164BR(quotedPhone)) {
          phone = quotedPhone;
          phoneE164 = normalizeToE164BR(quotedPhone) || "";
          if (targetChatId) session.cache.chatIdPhoneCache.set(targetChatId, quotedPhone);
        }
      }
    }

    if (!phoneE164 && targetChatId) {
      const cachedPhone = session.cache.chatIdPhoneCache.get(targetChatId);
      if (cachedPhone && normalizeToE164BR(cachedPhone)) {
        phone = cachedPhone;
        phoneE164 = normalizeToE164BR(cachedPhone) || "";
      }
    }

    if (!phoneE164) {
      phone = resolvePhone(targetContact, msg, chat);
      phoneE164 = normalizeToE164BR(phone) || "";
    }

    const nome = resolveNome(targetContact, chat, phone);
    const nomeNewBR = resolveNomeNewBR(targetContact, phone);
    const contactType = resolveTipoContato(chat, targetChatId);

    const ctx = {
      contactType,
      name: nome,
      phoneE164,
      chatId: targetChatId,
      origin: "AGENTE",
      sessionName: session?.name || ""
    };
    const content = formatConteudoParaLog(msg);

    if (isGroup) return { ctx, content, errorForLog: null };

    let errorForLog = null;
    if (!phoneE164) {
      errorForLog = {
        type: "PHONE_NOT_FOUND",
        details: "Telefone do cliente nao identificado para esta conversa."
      };
      return { ctx, content, errorForLog };
    }

    if (deps.commandsService && corpo.startsWith("#")) {
      try {
        const result = await deps.commandsService.handleAgentCommand({
          text: corpo,
          deviceId: deps.deviceId || null,
          devicePhone: session?.devicePhone || "",
          phone,
          phoneE164,
          name: nome
        });
        if (result?.handled) {
          if (result.response) {
            await replyBot(session, msg, phone, nome, result.response);
          }
          if (result?.scheduleFollowUp) {
            const chatId = resolveChatIdConversa(msg);
            const phoneE164Final = normalizeToE164BR(phone) || phone;
            if (chatId && phoneE164Final) {
              deps.followUpService?.schedule({
                clientPhone: phoneE164Final,
                chatId,
                createdAt: new Date().toISOString(),
                clientName: nome,
                sessionName: session?.name || "",
                deviceId: deps.deviceId || null
              });
            }
          }
          return { ctx, content, errorForLog };
        }
      } catch (err) {
        errorForLog = { type: "AGENT_COMMAND_ERROR", details: err?.message || "Falha no comando #", err };
        return { ctx, content, errorForLog };
      }
    }

    const state = session.state;

    if (isInstrucaoMensagem(corpo)) {
      state.fluxoCelular.set(phone, {
        stage: "aguardando_prova",
        confirming: false,
        printReminderSent: false,
        mac: null
      });
      logFluxoIdentificado("CELULAR/IBO", phone, nome);
    }
    if (isInstrucaoLazer(corpo)) {
      await iniciarFluxoLazer(session, null, phone);
      logger.info(
        `[LAZER] Instrucao detectada para ${phone}. Aguardando a foto do cliente para seguir com o teste.`
      );
    }

    const token = corpoUpper.startsWith("#") ? corpoUpper.split(/\s+/)[0] : "";

    const commandIndex = token ? await getCommandIndex() : null;
    const command = commandIndex ? commandIndex.activeByToken.get(token) : null;
    if (token && !command) return { ctx, content, errorForLog };

    if (command?.flow === "IBO") {
      if (msg.hasMedia) {
        const leitura = await lerMacDaImagem(msg);
        if (leitura?.ok && leitura.mac) {
          logger.info(`[IBO] MAC detectado em midia do agente: ${leitura.mac}`);
          await iniciarTesteIbo(session, leitura.mac, msg, phone, nomeNewBR);
        } else {
          if (leitura?.errorType) {
            errorForLog = { type: leitura.errorType, details: leitura.reason, err: leitura.err };
          }
          if (targetChatId) {
            state.aguardandoMac.add(targetChatId);
            state.aguardandoMacAgente.set(targetChatId, { phone, nome: nomeNewBR, fluxo: "IBO" });
          }
          logFluxoIdentificado("IBO - MAC", phone, nomeNewBR);
          await replyBot(session, msg, phone, nomeNewBR, MSG_OCR_FALHA_AGUARDANDO_AGENTE);
        }
        return { ctx, content, errorForLog };
      }

      const macInline = extrairMacDeTexto(corpo);
      if (macInline) {
        const pending = targetChatId ? state.aguardandoMacAgente.get(targetChatId) : null;
        if (targetChatId) {
          state.aguardandoMac.delete(targetChatId);
          state.aguardandoMacAgente.delete(targetChatId);
        }
        if (pending?.fluxo === "CELULAR") {
          await concluirFluxoCelular(session, msg, phone, nomeNewBR, macInline);
        } else {
          await iniciarTesteIbo(session, macInline, msg, phone, nomeNewBR);
        }
        return { ctx, content, errorForLog };
      }

      const handled = await handleIboMensagemMarcada(session, msg, phone, nomeNewBR);
      if (handled?.ocr?.errorType) {
        const textLog = buildOcrTextLog(handled?.ocr?.extractedText || "");
        const details = handled.ocr.reason + (textLog.text ? ` | texto: ${textLog.text}` : "");
        errorForLog = { type: handled.ocr.errorType, details, err: handled.ocr.err };
      }
      if (handled?.handled) {
        return { ctx, content, errorForLog };
      } else {
        if (targetChatId) {
          state.aguardandoMac.add(targetChatId);
          state.aguardandoMacAgente.set(targetChatId, { phone, nome: nomeNewBR, fluxo: "IBO" });
        }
        logFluxoIdentificado("IBO - MAC", phone, nomeNewBR);
        await replyBot(session, msg, phone, nomeNewBR, "Marque a imagem com o MAC ou envie o MAC junto ao #IBO.");
        return { ctx, content, errorForLog };
      }
    } else if (command?.flow === "ASSIST") {
      await responderComTeste(session, msg, phone, nomeNewBR, APP_PROFILES.ASSIST);
    } else if (command?.flow === "LAZER") {
      await responderComTeste(session, msg, phone, nomeNewBR, APP_PROFILES.LAZER);
    } else if (command?.flow === "FUN") {
      await responderComTeste(session, msg, phone, nomeNewBR, APP_PROFILES.FUN);
    } else if (command?.flow === "PLAYSIM") {
      await responderComTeste(session, msg, phone, nomeNewBR, APP_PROFILES.PLAYSIM);
    }

    return { ctx, content, errorForLog };
  }

  async function processCustomFlow(session, msg, phone, phoneE164, nome, textoLower, customVariables) {
    if (!deps.configService) return false;
    const current = session.state.customFlows.get(phone);
    const flows = await deps.configService.getFlows({ includeDisabled: false, deviceId: deps.deviceId || null });

    if (current) {
      const flowDef = flows.find((flow) => flow.id === current.flowId || flow.name === current.flowName);
      if (!flowDef || !Array.isArray(flowDef.stages)) {
        session.state.customFlows.delete(phone);
        return false;
      }
      const nextIndex = current.stageIndex + 1;
      if (nextIndex >= flowDef.stages.length) {
        session.state.customFlows.delete(phone);
        return false;
      }
      const stage = flowDef.stages[nextIndex];
      const message = typeof stage === "string" ? stage : stage?.message;
      if (message) {
        const rendered = renderTemplateWithVariables(message, {
          name: nome,
          phone: phoneE164 || phone || "",
          variables: customVariables
        });
        await replyBot(session, msg, phone, nome, rendered);
        session.state.customFlows.set(phone, {
          flowId: flowDef.id,
          flowName: flowDef.name,
          stageIndex: nextIndex
        });
        await logInteractionEvent({
          deviceId: deps.deviceId,
          phone: normalizeToE164BR(phone) || phone,
          name: nome,
          contactType: "CONTATO",
          origin: "BOT",
          eventType: "flow_stage",
          flow: flowDef.name,
          stage: String(nextIndex)
        });
        return true;
      }
      return false;
    }

    const flowTrigger = await deps.configService.findFlowTrigger(textoLower, deps.deviceId || null);
    if (!flowTrigger) return false;
    if (!Array.isArray(flowTrigger.stages) || !flowTrigger.stages.length) return false;
    const firstStage = flowTrigger.stages[0];
    const message = typeof firstStage === "string" ? firstStage : firstStage?.message;
    if (message) {
      const rendered = renderTemplateWithVariables(message, {
        name: nome,
        phone: phoneE164 || phone || "",
        variables: customVariables
      });
      await replyBot(session, msg, phone, nome, rendered);
      session.state.customFlows.set(phone, { flowId: flowTrigger.id, flowName: flowTrigger.name, stageIndex: 0 });
      await logInteractionEvent({
        deviceId: deps.deviceId,
        phone: normalizeToE164BR(phone) || phone,
        name: nome,
        contactType: "CONTATO",
        origin: "BOT",
        eventType: "flow_started",
        flow: flowTrigger.name,
        stage: "0"
      });
      return true;
    }
    return false;
  }

  async function processMessage(session, msg) {
    const contact = await msg.getContact().catch(() => null);
    const chat = await msg.getChat().catch(() => null);
    const chatId = msg?.from || "";
    const phone = resolvePhone(contact, msg, chat);
    const nome = resolveNome(contact, chat, phone);
    const nomeNewBR = resolveNomeNewBR(contact, phone);
    const texto = (msg.body || "").trim();
    const textoLower = texto.toLowerCase();
    const contactType = resolveTipoContato(chat, chatId);
    const phoneE164 = normalizeToE164BR(phone) || "";
    if (chatId && phoneE164) {
      session.cache.chatIdPhoneCache.set(chatId, phone);
    }

    let errorForLog = null;
    const finish = () => ({
      ctx: { contactType, name: nome, phoneE164, chatId, origin: "CLIENTE", sessionName: session?.name || "" },
      errorForLog
    });

    if (contactType === "GRUPO") return finish();

    const state = session.state;
    const estadoLazer = state.fluxoLazer.get(phone);

    if (msg.hasMedia) {
      if (estadoLazer) {
        await handleFluxoLazerImagem(session, msg, phone, nome);
        return finish();
      }

      if (chatId && state.aguardandoMac.has(chatId)) {
        const res = await handleIboImagem(session, msg, phone, nomeNewBR);
        if (res?.ocr?.errorType) {
          errorForLog = { type: res.ocr.errorType, details: res.ocr.reason, err: res.ocr.err };
        }
        return finish();
      }

      const estadoCelular = state.fluxoCelular.get(phone);
      if (estadoCelular?.stage === "aguardando_prova") {
        const leitura = await lerMacDaImagem(msg);
        if (leitura.ok && leitura.mac) {
          state.fluxoCelular.set(phone, {
            ...estadoCelular,
            mac: leitura.mac,
            confirming: false,
            printReminderSent: true
          });
          await concluirFluxoCelular(session, msg, phone, nomeNewBR, leitura.mac);
        } else {
          if (leitura?.errorType) {
            errorForLog = { type: leitura.errorType, details: leitura.reason, err: leitura.err };
          }
          state.fluxoCelular.delete(phone);
          if (chatId) {
            state.aguardandoMac.add(chatId);
            state.aguardandoMacAgente.set(chatId, { phone, nome: nomeNewBR, fluxo: "CELULAR" });
          }
          await replyBot(session, msg, phone, nomeNewBR, MSG_OCR_FALHA_AGUARDANDO_AGENTE);
        }
        return finish();
      }
      return finish();
    }

    const comando = texto.toUpperCase();
    const token = comando.startsWith("#") ? comando.split(/\s+/)[0] : "";
    if (token) return finish();

    if (estadoLazer) {
      const handledLazer = await handleFluxoLazerMensagem(session, msg, phone, textoLower);
      if (handledLazer) return finish();
    }

    const handledFluxoCelular = await handleFluxoCelular(session, msg, phone, nome, textoLower);
    if (handledFluxoCelular) return finish();

    const customVariables = await getCustomVariablesMap();
    if (await processCustomFlow(session, msg, phone, phoneE164, nome, textoLower, customVariables)) {
      return finish();
    }

    const quickReply = await deps.configService?.findQuickReply(textoLower, deps.deviceId || null);
    if (quickReply?.response) {
      const rendered = renderQuickReplyTemplate(quickReply.response, {
        name: nome,
        phone: phoneE164 || phone || "",
        variables: customVariables
      });
      await replyBot(session, msg, phone, nome, rendered);
      return finish();
    }

    return finish();
  }

  async function logInteractionEvent(event) {
    if (!deps.onInteraction) return;
    try {
      await deps.onInteraction(event);
    } catch (err) {
      logger.error("[DB] Falha ao gravar interacao", err);
    }
  }

  async function logMessageEvent(event) {
    if (!deps.onMessage) return;
    try {
      await deps.onMessage(event);
    } catch (err) {
      logger.error("[DB] Falha ao gravar mensagem", err);
    }
  }

  return {
    touchActivity,
    markBotSent,
    getSerializedMessageId,
    resolveTipoContato,
    formatConteudoParaLog,
    processMessage,
    processAgentMessage,
    logInteractionEvent,
    logMessageEvent
  };
}
