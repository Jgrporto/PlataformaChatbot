import wweb from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import axios from "axios";
import Tesseract from "tesseract.js";
import express from "express";
import { criarUsuarioGerenciaAppComM3u } from "./gerenciaApp.js";
import { logger } from "./utils/logger.js";
import { normalizeToE164BR } from "./utils/phone.js";
import { extractMacFromImageBuffer, extractMacFromText } from "./services/ocrService.js";
import { criarTesteNewBR } from "./services/newbrService.js";
import { FollowUpService } from "./services/followUpService.js";

const { Client, LocalAuth } = wweb;

const DEVICE_PHONE = "5524999162165";
const KEYWORD_ASSIST = "ASSIST PLUS";
const KEYWORD_LAZER = "LAZER PLAY";
const KEYWORD_FUN = "FUN PLAY";
const KEYWORD_PLAYSIM = "PLAYSIM";
const COMMANDS = {
  ASSIST: "#ASSIST",
  LAZER: "#LAZER",
  IBO: "#IBO",
  FUN: "#FUN",
  PLAYSIM: "#PLAYSIM"
};
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
  "Ah sim! Só um momento, vou ativar o seu teste aqui no sistema.\n" +
  "Não consegui achar o MAC na imagem, um atendente vai te responder agora.";


function normalizeInstrucao(str) {
  return (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function isInstrucaoMensagem(texto) {
  const norm = normalizeInstrucao(texto);
  return norm.includes(INSTRUCAO_TRIGGER) || norm.includes(INSTRUCAO_TRIGGER_2);
}

function isInstrucaoLazer(texto) {
  const norm = normalizeInstrucao(texto);
  return (
    norm.includes(LAZER_INSTRUCAO_TRIGGER) ||
    norm.includes(LAZER_INSTRUCAO_TRIGGER_PLAYLIST)
  );
}
const aguardandoMac = new Set(); // chatId (compat: permite cliente enviar #IBO com MAC digitado)
const aguardandoMacAgente = new Map(); // chatId -> { phone, nome, fluxo }
const fluxoCelular = new Map(); // chatId -> { stage: 'aguardando_prova', confirming: bool, mac?: string, printReminderSent?: bool }
const fluxoLazer = new Map(); // chatId -> { stage: 'aguardando_foto' | 'aguardando_playlist_click' }
let latestQr = "";
const app = express();
const QR_PORT = process.env.PORT || 3000;
const SELF_PING_URL = process.env.SELF_PING_URL || "";
const IDLE_LOG_MS = Number(process.env.IDLE_LOG_MS || 300000); // 5 min
const FOLLOWUP_MS = Number(process.env.FOLLOWUP_MS || 4 * 60 * 60 * 1000); // 4h padrao
const FOLLOWUP_STORAGE_PATH = process.env.FOLLOWUP_STORAGE_PATH || "data/followups.json";
const followUpService = new FollowUpService({
  storagePath: FOLLOWUP_STORAGE_PATH,
  delayMs: FOLLOWUP_MS,
  logger
});
followUpService.init().catch((err) => logger.error("[FollowUp] Falha ao iniciar serviço", err));

let lastActivity = Date.now();
const touchActivity = () => {
  lastActivity = Date.now();
};

const botSentMessageIds = new Set();
const botSentFingerprints = new Map(); // key -> expiresAtMs
const agentProcessedMessageIds = new Set();

function markBotSent(chatId, body) {
  if (!chatId) return;
  const text = (body || "").trim();
  const key = `${chatId}|${text}`;
  botSentFingerprints.set(key, Date.now() + 15000);
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

async function replyBot(msg, phoneDigits, nome, texto) {
  const chatId = resolveChatIdConversa(msg) || "";
  markBotSent(chatId, texto);
  const ctx = {
    contactType: resolveTipoContato(null, chatId),
    name: (nome || "").trim(),
    phoneE164: normalizeToE164BR(phoneDigits) || "",
    chatId,
    origin: "BOT"
  };

  try {
    const sent = await msg.reply(texto);
    const id = sent?.id?._serialized;
    if (id) botSentMessageIds.add(id);
    logger.messageSent(ctx, texto);
    return sent;
  } catch (err) {
    logger.messageSent(ctx, texto, { error: { type: "SEND_ERROR", details: err?.message, err } });
    throw err;
  }
}

async function processAgentMessage(msg) {
  const corpo = (msg?.body || "").trim();
  const corpoUpper = corpo.toUpperCase();
  const targetChatId = msg?.to || msg?.from || "";

  const chat = await msg.getChat().catch(() => null);
  const isGroup = !!chat?.isGroup || targetChatId.endsWith("@g.us");

  const targetContact = targetChatId
    ? await client.getContactById(targetChatId).catch(() => null)
    : null;

  const phone = cleanPhone(targetContact?.number || targetChatId);
  const nome = resolveNome(targetContact, chat, phone);
  const nomeNewBR = resolveNomeNewBR(targetContact, phone);
  const phoneE164 = normalizeToE164BR(phone) || "";
  const contactType = resolveTipoContato(chat, targetChatId);

  const ctx = { contactType, name: nome, phoneE164, chatId: targetChatId, origin: "AGENTE" };
  const content = formatConteudoParaLog(msg);

  if (isGroup) return { ctx, content, errorForLog: null };

  if (isInstrucaoMensagem(corpo)) {
    fluxoCelular.set(phone, { stage: "aguardando_prova", confirming: false, printReminderSent: false, mac: null });
    logFluxoIdentificado("CELULAR/IBO", phone, nome);
  }
  if (isInstrucaoLazer(corpo)) {
    await iniciarFluxoLazer(null, phone);
    logger.info(`[LAZER] Instrucao detectada para ${phone}. Aguardando a foto do cliente para seguir com o teste.`);
  }

  const token = corpoUpper.startsWith("#") ? corpoUpper.split(/\s+/)[0] : "";
  let errorForLog = null;

  if (token === COMMANDS.IBO) {
    // 1) #IBO com mídia enviada pelo próprio agente (lê o MAC direto da imagem)
    if (msg.hasMedia) {
      const leitura = await lerMacDaImagem(msg);
      if (leitura?.ok && leitura.mac) {
        logger.info(`[IBO] MAC detectado em midia do agente: ${leitura.mac}`);
        await iniciarTesteIbo(leitura.mac, msg, phone, nomeNewBR);
      } else {
        if (leitura?.errorType) {
          errorForLog = { type: leitura.errorType, details: leitura.reason, err: leitura.err };
        }
        if (targetChatId) {
          aguardandoMac.add(targetChatId);
          aguardandoMacAgente.set(targetChatId, { phone, nome: nomeNewBR, fluxo: "IBO" });
        }
        logFluxoIdentificado("IBO - MAC", phone, nomeNewBR);
        await replyBot(msg, phone, nomeNewBR, MSG_OCR_FALHA_AGUARDANDO_AGENTE);
      }
      return { ctx, content, errorForLog };
    }

    const macInline = extrairMacDeTexto(corpo);
    if (macInline) {
      const pending = targetChatId ? aguardandoMacAgente.get(targetChatId) : null;
      if (targetChatId) {
        aguardandoMac.delete(targetChatId);
        aguardandoMacAgente.delete(targetChatId);
      }
      if (pending?.fluxo === "CELULAR") {
        await concluirFluxoCelular(msg, phone, nomeNewBR, macInline);
      } else {
        await iniciarTesteIbo(macInline, msg, phone, nomeNewBR);
      }
      return { ctx, content, errorForLog };
    }

    // 2) #IBO marcando mensagem com imagem do cliente
    const handled = await handleIboMensagemMarcada(msg, phone, nomeNewBR);
    if (handled?.ocr?.errorType) {
      errorForLog = { type: handled.ocr.errorType, details: handled.ocr.reason, err: handled.ocr.err };
    }
    if (handled?.handled) {
      return { ctx, content, errorForLog };
    } else {
      if (targetChatId) {
        aguardandoMac.add(targetChatId);
        aguardandoMacAgente.set(targetChatId, { phone, nome: nomeNewBR, fluxo: "IBO" });
      }
      logFluxoIdentificado("IBO - MAC", phone, nomeNewBR);
      await replyBot(msg, phone, nomeNewBR, "Marque a imagem com o MAC ou envie o MAC junto ao #IBO.");
      return { ctx, content, errorForLog };
    }
  } else if (token === COMMANDS.ASSIST) {
    await responderComTeste(msg, phone, nomeNewBR, APP_PROFILES.ASSIST);
  } else if (token === COMMANDS.LAZER) {
    await responderComTeste(msg, phone, nomeNewBR, APP_PROFILES.LAZER);
  } else if (token === COMMANDS.FUN) {
    await responderComTeste(msg, phone, nomeNewBR, APP_PROFILES.FUN);
  } else if (token === COMMANDS.PLAYSIM) {
    await responderComTeste(msg, phone, nomeNewBR, APP_PROFILES.PLAYSIM);
  }

  return { ctx, content, errorForLog };
}

function logFluxoIdentificado(tipo, phone, nome) {
  const safeTipo = (tipo || "N/A").toUpperCase();
  logger.info(`FLUXO IDENTIFICADO (${safeTipo}) AGUARDANDO INSTRUÇÕES DO CLIENTE - ${phone} (${nome || "Cliente"})`);
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

function resolvePhone(contact, msg) {
  const raw =
    contact?.number ||
    msg?.from ||
    msg?.to ||
    "";
  return cleanPhone(raw);
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

const APP_PROFILES = {
  ASSIST: { keyword: KEYWORD_ASSIST, appName: "assist", display: "🟡 ASSIST PLUS", code: "centertv" },
  LAZER: { keyword: KEYWORD_LAZER, appName: "lazer play", display: "🟡 LAZER PLAY", code: "br99" },
  // FUN usa o mesmo bloco/credencial do LAZER, apenas troca o título exibido
  FUN: { keyword: KEYWORD_LAZER, appName: "lazer play", display: "🟡 FUN PLAY", code: "br99" },
  // PLAYSIM busca o bloco do ASSIST, mas exibe título PLAYSIM
  PLAYSIM: { keyword: KEYWORD_ASSIST, appName: "playsim", display: "🟡 PLAYSIM", code: "centertv" }
};

function nomeSeguro(nome, phone) {
  const n = (nome || "").trim();
  return n || phone || "Cliente";
}

function resolveChatIdConversa(msg) {
  return msg?.fromMe ? msg?.to : msg?.from;
}

async function gerarTesteSeguro(cliente, nome = "", appEscolhido = "", mac) {
  try {
    return await gerarTeste(cliente, nome, appEscolhido, mac);
  } catch (err) {
    logger.error("[Teste] Falha ao gerar teste", err);
    return null;
  }
}

function cleanPhone(raw) {
  return (raw || "").replace(/[^\d]/g, "");
}

function extrairM3u(texto) {
  if (!texto) return null;

  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const urlFromLine = (line) => {
    const m = line.match(/https?:\/\/[^\s]+/i);
    return m ? m[0] : null;
  };

  const preferidas = linhas.filter((l) => /HLS|M3U/i.test(l));
  for (const l of preferidas) {
    const url = urlFromLine(l);
    if (url) return url;
  }

  const mPlus = texto.match(/https?:\/\/[^\s]+m3u_plus[^\s]*/i);
  if (mPlus) return mPlus[0];

  const qualquer = texto.match(/https?:\/\/[^\s]+/i);
  return qualquer ? qualquer[0] : null;
}

function filtrarBloco(texto, keyword) {
  if (!texto) return "";
  const linhas = texto.split(/\r?\n/);
  const keywordUpper = keyword.toUpperCase();
  const headerRegex = /^[ðŸŸ¢ðŸŸ¡ðŸŸ£ðŸŸ ðŸ”´]/;

  let capturando = false;
  const resultado = [];

  for (const linha of linhas) {
    const lineClean = linha.trim();

    if (lineClean.toUpperCase().includes(keywordUpper)) {
      capturando = true;
      resultado.push(lineClean);
      continue;
    }

    if (capturando && headerRegex.test(lineClean) && !lineClean.toUpperCase().includes(keywordUpper)) {
      break;
    }

    if (capturando) resultado.push(lineClean);
  }

  return resultado.join("\n").trim();
}

function extrairUsuarioDoM3u(m3uUrl) {
  if (!m3uUrl) return null;

  try {
    const asUrl = new URL(m3uUrl);
    const paramUser = asUrl.searchParams.get("username");
    if (paramUser) return paramUser;
  } catch (err) {
    // segue para regex fallback
  }

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

async function lerMacDaImagem(msg) {
  if (!msg.hasMedia) return { ok: false, reason: "Mensagem nao possui midia" };

  const media = await msg.downloadMedia();
  if (!media?.data) return { ok: false, reason: "Falha ao baixar a midia" };

  const buffer = Buffer.from(media.data, "base64");
  const result = await extractMacFromImageBuffer(buffer);

  if (result.ok) {
    return { ok: true, mac: result.mac, reason: "", errorType: null, extractedText: result.extractedText || "" };
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
  const candidate =
    contact?.verifiedName ||
    contact?.pushname ||
    contact?.name ||
    "";

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

async function gerarTeste(clientePhoneDigits, clientName, appEscolhido = "", mac) {
  const phoneDigits = cleanPhone(clientePhoneDigits);
  const whatsappE164 = normalizeToE164BR(phoneDigits);
  const appName = resolveAppName(appEscolhido);

  if (!whatsappE164) {
    throw new Error(`WhatsApp inválido para E.164: "${clientePhoneDigits}"`);
  }

  return criarTesteNewBR({
    appName,
    devicePhone: DEVICE_PHONE,
    clientName: (clientName || "").trim() || "",
    clientWhatsappE164: whatsappE164,
    flowLabel: buildFlowLabel(appName, mac)
  });
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
      const mUser = cleanLine.match(/(?:usuario|usuário|user|login)[:=\-]?\s*(.+)/i);
      if (mUser) usuario = mUser[1].trim();
    }
    if (!senha) {
      const mPass = cleanLine.match(/(?:senha|password|pass)[:=\-]?\s*(.+)/i);
      if (mPass) senha = mPass[1].trim();
    }
  }
  return { codigo, usuario, senha };
}

async function responderComTeste(msg, phone, nome, profile, mac) {
  const { keyword, appName, display, code: defaultCode } = profile;
  const reply = await gerarTesteSeguro(phone, nome, appName, mac);
  if (!reply) {
    await replyBot(msg, phone, nome, "So um momento! Vou chamar um dos atendentes.");
    return;
  }

  if (detectouLimite(reply)) {
    await replyBot(msg, phone, nome, MSG_TESTE_ATIVO);
    return;
  }

  let filtrado = filtrarBloco(reply, keyword);

  if (!filtrado) {
    await replyBot(msg, phone, nome, `Nao encontrei conteudo para ${keyword}.`);
    return;
  }

  // Remove palavras-chave e comandos antes de enviar ao cliente
  const keywordRegex = new RegExp(keyword, "gi");
  const comandosRegex = new RegExp(
    `${COMMANDS.LAZER}|${COMMANDS.ASSIST}|${COMMANDS.FUN}|${COMMANDS.PLAYSIM}`,
    "gi"
  );
  filtrado = filtrado.replace(keywordRegex, "").replace(comandosRegex, "").trim();

  const cred = extrairCredenciais(filtrado);
  const codigoFinal = cred.codigo || defaultCode;

  if (cred.usuario || cred.senha || codigoFinal) {
    const partes = [display, ""];
    if (codigoFinal) partes.push(`✅   Cod: ${codigoFinal}`);
    if (cred.usuario) partes.push(`✅  *Usuário:* ${cred.usuario}`);
    if (cred.senha) partes.push(`✅  *Senha:* ${cred.senha}`);
    await replyBot(msg, phone, nome, partes.join("\n"));
  } else {
    await replyBot(msg, phone, nome, filtrado);
  }

  const chatId = resolveChatIdConversa(msg);
  const phoneE164 = normalizeToE164BR(phone);
  if (chatId && phoneE164) {
    followUpService.schedule({
      clientPhone: phoneE164,
      chatId,
      createdAt: new Date().toISOString(),
      clientName: nome
    });
  }
}

async function iniciarTesteIbo(mac, msg, phone, nome) {
  const macSanitized = (mac || "").trim();
  if (!macSanitized) {
    await replyBot(msg, phone, nome, "MAC nao identificado. Envie a imagem com o MAC visivel, por favor.");
    return;
  }

  const reply = await gerarTesteSeguro(phone, nome, "IBO REVENDA", macSanitized);
  if (!reply) {
    await replyBot(msg, phone, nome, "So um momento! Vou chamar um dos atendentes.");
    return;
  }
  if (detectouLimite(reply)) {
    fluxoCelular.delete(phone);
    await replyBot(msg, phone, nome, MSG_TESTE_ATIVO);
    return;
  }

  const m3u = extrairM3u(reply);
  if (!m3u) {
    await replyBot(msg, phone, nome, "Nao consegui extrair o link M3U do teste.");
    return;
  }

  const username = extrairUsuarioDoM3u(m3u) || nome || phone;
  const serverName = `TVAUTO ${username || "Cliente"}`;
  const observacoes = `Teste Gerado via Chatbot\nMAC: ${macSanitized}`;

  try {
    await criarUsuarioGerenciaAppComM3u(m3u, {
      mac: macSanitized,
      serverName,
      app: "IBO",
      nome,
      whatsapp: phone,
      observacoes,
      minimalFields: true
    });
  } catch (err) {
    logger.error("[IBO] Falha ao cadastrar no GerenciaApp", err);
    await replyBot(msg, phone, nome, "Falha ao salvar no GerenciaApp, tente novamente mais tarde.");
    return;
  }

  await replyBot(msg, phone, nome, MSG_TESTE_IBO_OK);
  const chatId = resolveChatIdConversa(msg);
  const phoneE164 = normalizeToE164BR(phone);
  if (chatId && phoneE164) {
    followUpService.schedule({
      clientPhone: phoneE164,
      chatId,
      createdAt: new Date().toISOString(),
      clientName: nome
    });
  }
}

async function handleIboImagem(msg, phone, nome) {
  const chatId = msg?.from || "";
  const leitura = await lerMacDaImagem(msg);

  if (!leitura.ok || !leitura.mac) {
    if (chatId) {
      aguardandoMac.add(chatId);
      aguardandoMacAgente.set(chatId, { phone, nome, fluxo: "IBO" });
    }
    logFluxoIdentificado("IBO - MAC", phone, nome);
    await replyBot(msg, phone, nome, MSG_OCR_FALHA_AGUARDANDO_AGENTE);
    return { ok: false, ocr: leitura };
  }

  if (chatId) {
    aguardandoMac.delete(chatId);
    aguardandoMacAgente.delete(chatId);
  }
  await iniciarTesteIbo(leitura.mac, msg, phone, nome);
  return { ok: true, mac: leitura.mac };
}

async function handleIboMensagemMarcada(msg, phone, nome) {
  let quoted = await msg.getQuotedMessage().catch((err) => {
    if (msg?.hasQuotedMsg) {
      logger.error("[IBO] Falha ao obter quotedMsg", err);
    }
    return null;
  });

  // fallback: tenta pegar quoted por id bruto
  if (!quoted) {
    const qid =
      msg?._data?.quotedStanzaID ||
      msg?._data?.quotedMsgId ||
      msg?._data?.quotedMessageId ||
      msg?._data?.quotedMessage?._serialized ||
      null;
    if (qid) {
      quoted = await client.getMessageById(qid).catch(() => null);
    }
  }

  if (!quoted) return { handled: false, ocr: null };

  logger.info(`[IBO] Processando imagem marcada por agente (quotedId=${quoted.id?._serialized || "n/a"})`);

  if (!quoted.hasMedia) {
    logger.warn(`[IBO] QuotedMsg sem media para ${phone} (quotedId=${quoted.id?._serialized || "n/a"})`);
    await replyBot(
      msg,
      phone,
      nome,
      "A mensagem marcada nao tem imagem. Encaminhe a imagem com o MAC ou envie novamente marcando a foto."
    );
    return { handled: true, ocr: { ok: false, errorType: "OCR_NO_MEDIA", reason: "Mensagem marcada sem midia" } };
  }

  let leitura = null;
  const OCR_MARK_TIMEOUT_MS = Number(process.env.OCR_MARK_TIMEOUT_MS || 15000);
  let ocrTimeoutId = null;
  try {
    logger.info("[IBO] Iniciando OCR da imagem marcada (agente)");
    const timeoutPromise = new Promise((_, reject) => {
      ocrTimeoutId = setTimeout(
        () => reject(new Error(`Timeout OCR imagem marcada apos ${OCR_MARK_TIMEOUT_MS}ms`)),
        OCR_MARK_TIMEOUT_MS
      );
    });
    leitura = await Promise.race([lerMacDaImagem(quoted), timeoutPromise]);
  } catch (err) {
    logger.error("[IBO] Falha ao ler MAC da imagem marcada", err);
    return {
      handled: true,
      ocr: { ok: false, errorType: "OCR_ERROR", reason: err?.message || "Erro ao ler imagem marcada", err }
    };
  } finally {
    if (ocrTimeoutId) clearTimeout(ocrTimeoutId);
  }
  if (!leitura.ok || !leitura.mac) {
    const chatId = msg?.from || msg?.to || "";
    if (chatId) {
      aguardandoMac.add(chatId);
      aguardandoMacAgente.set(chatId, { phone, nome, fluxo: "IBO" });
    }
    logger.warn("[IBO] OCR nao encontrou MAC na imagem marcada pelo agente", {
      phone,
      nome,
      reason: leitura.reason || "sem motivo"
    });
    await replyBot(msg, phone, nome, MSG_OCR_FALHA_AGUARDANDO_AGENTE);
    return { handled: true, ocr: leitura };
  }

  const chatId = msg?.from || msg?.to || "";
  if (chatId) {
    aguardandoMac.delete(chatId);
    aguardandoMacAgente.delete(chatId);
  }
  logger.info(`[IBO] MAC detectado via imagem marcada pelo agente: ${leitura.mac}`);
  await iniciarTesteIbo(leitura.mac, msg, phone, nome);
  return { handled: true, ocr: null };
}

function textoSim(textoLower) {
  return ["sim", "s", "yes", "yep", "isso", "pode", "ok", "okay"].some((k) => {
    const re = new RegExp(`\\b${k}\\b`, "i");
    return re.test(textoLower);
  });
}

function textoNao(textoLower) {
  return ["nao", "nÃ£o", "n", "no", "negativo"].some((k) => {
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

async function concluirFluxoCelular(msg, phone, nome, macFromMedia) {
  const estado = fluxoCelular.get(phone) || {};
  const mac = macFromMedia || estado.mac;

  if (!mac) {
    fluxoCelular.set(phone, {
      ...estado,
      mac: null,
      stage: "aguardando_prova",
      confirming: false,
      printReminderSent: true
    });
    await replyBot(msg, phone, nome, "Preciso de uma foto com o MAC visivel para liberar. Envie a imagem do app aberto, por favor.");
    return;
  }

  const reply = await gerarTesteSeguro(phone, nome, "CELULAR");
  if (!reply) {
    await replyBot(msg, phone, nome, "So um momento! Vou chamar um dos atendentes.");
    return;
  }
  if (detectouLimite(reply)) {
    fluxoCelular.delete(phone);
    await replyBot(msg, phone, nome, MSG_TESTE_ATIVO);
    return;
  }

  const m3u = extrairM3u(reply);
  if (!m3u) {
    logger.warn("[CELULAR] Nao foi possivel extrair M3U do teste para cadastro.");
    await replyBot(msg, phone, nome, "Seu teste foi gerado! Fecha o app e abre novamente.");

    const chatId = resolveChatIdConversa(msg);
    const phoneE164 = normalizeToE164BR(phone);
    if (chatId && phoneE164) {
      followUpService.schedule({
        clientPhone: phoneE164,
        chatId,
        createdAt: new Date().toISOString(),
        clientName: nome
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
    fluxoCelular.delete(phone);
  }

  await replyBot(msg, phone, nome, "Seu teste foi gerado! Fecha o app e abre novamente.");
  const chatId = resolveChatIdConversa(msg);
  const phoneE164 = normalizeToE164BR(phone);
  if (chatId && phoneE164) {
    followUpService.schedule({
      clientPhone: phoneE164,
      chatId,
      createdAt: new Date().toISOString(),
      clientName: nome
    });
  }
}

async function handleFluxoCelular(msg, phone, nome, textoLower) {
  const estado = fluxoCelular.get(phone);

  if (!estado) return false;

  if (estado?.confirming) {
    if (textoSim(textoLower)) {
      fluxoCelular.set(phone, { ...estado, confirming: false });
      if (estado.stage === "aguardando_prova") {
        await replyBot(msg, phone, nome, MSG_PEDIR_PRINT);
      }
      return true;
    }
    if (textoNao(textoLower)) {
      fluxoCelular.delete(phone);
      await replyBot(msg, phone, nome, "Um atendente vai responder em instantes. Obrigado!");
      return true;
    }
    return false;
  }

  if (estado.stage === "aguardando_prova") {
    if (!estado.printReminderSent) {
      fluxoCelular.set(phone, { ...estado, printReminderSent: true });
      await replyBot(msg, phone, nome, MSG_PEDIR_PRINT);
    }
    return true;
  }

  return false;
}

async function handleFluxoLazerImagem(msg, phone, nome) {
  const leitura = await lerTextoDaImagem(msg);
  if (!leitura.ok) {
    await replyBot(msg, phone, nome, "Nao consegui ler a imagem. Envie uma foto mais nitida da tela da TV, por favor.");
    return true;
  }

  const textoUpper = (leitura.texto || "").toUpperCase();
  const hasPlaylist = textoUpper.includes("PLAYLIST");
  const hasLista = textoUpper.includes("LISTA");
  const hasCodigo = textoUpper.includes("CODIGO") || textoUpper.includes("CODE");

  if ((hasPlaylist || hasLista) && !hasCodigo) {
    fluxoLazer.set(phone, { stage: "aguardando_playlist_click" });
    await replyBot(msg, phone, nome, "Aperta na opcao Playlist/Lista e me envia a tela seguinte para liberar o teste.");
    return true;
  }

  if ((hasPlaylist || hasLista) && hasCodigo) {
    fluxoLazer.delete(phone);
    await replyBot(msg, phone, nome, "Gerando o teste. Use o codigo enviado para preencher no app.");
    await responderComTeste(msg, phone, nome, APP_PROFILES.LAZER);
    return true;
  }

  if (hasCodigo) {
    fluxoLazer.delete(phone);
    await responderComTeste(msg, phone, nome, APP_PROFILES.LAZER);
    return true;
  }

  await replyBot(msg, phone, nome, "Preciso da tela do app (menu ou tela de adicionar lista). Envie uma foto nA-tida, por favor.");
  return true;
}

async function handleFluxoLazerMensagem(msg, phone, textoLower) {
  const estado = fluxoLazer.get(phone);
  if (!estado) return false;

  if (estado.stage === "aguardando_playlist_click") {
    await replyBot(msg, phone, "", "Clica na opcao Playlist e me envia a tela seguinte, por favor.");
    return true;
  }

  if (textoConfirmacaoLazer(textoLower)) {
    await replyBot(msg, phone, "", "Beleza! Me envia uma foto da tela da TV para seguirmos o fluxo.");
  } else {
    await replyBot(msg, phone, "", "So um momento que ja te respondo, por favor.");
  }

  return true;
}

async function iniciarFluxoLazer(msg, phone) {
  fluxoLazer.set(phone, { stage: "aguardando_foto" });
  logFluxoIdentificado("LAZER", phone, (msg && resolveNome(await msg.getContact().catch(() => null), await msg.getChat().catch(() => null), phone)) || phone);
  if (msg) {
    await replyBot(msg, phone, "", "Vamos seguir. Envie uma foto da tela da TV do app para continuar.");
  }
}

async function processMessage(msg) {
  const contact = await msg.getContact().catch(() => null);
  const chat = await msg.getChat().catch(() => null);
  const chatId = msg?.from || "";
  const phone = resolvePhone(contact, msg);
  const nome = resolveNome(contact, chat, phone);
  const nomeNewBR = resolveNomeNewBR(contact, phone);
  const texto = (msg.body || "").trim();
  const textoLower = texto.toLowerCase();
  const contactType = resolveTipoContato(chat, chatId);
  const phoneE164 = normalizeToE164BR(phone) || "";

  let errorForLog = null;
  const finish = () => ({ ctx: { contactType, name: nome, phoneE164, chatId, origin: "CLIENTE" }, errorForLog });

  if (contactType === "GRUPO") return finish();

  const estadoLazer = fluxoLazer.get(phone);

  if (msg.hasMedia) {
    if (estadoLazer) {
      await handleFluxoLazerImagem(msg, phone, nome);
      return finish();
    }

    if (chatId && aguardandoMac.has(chatId)) {
      const res = await handleIboImagem(msg, phone, nomeNewBR);
      if (res?.ocr?.errorType) {
        errorForLog = { type: res.ocr.errorType, details: res.ocr.reason, err: res.ocr.err };
      }
      return finish();
    }

    const estadoCelular = fluxoCelular.get(phone);
    if (estadoCelular?.stage === "aguardando_prova") {
      const leitura = await lerMacDaImagem(msg);
      if (leitura.ok && leitura.mac) {
        fluxoCelular.set(phone, { ...estadoCelular, mac: leitura.mac, confirming: false, printReminderSent: true });
        await concluirFluxoCelular(msg, phone, nomeNewBR, leitura.mac);
      } else {
        if (leitura?.errorType) {
          errorForLog = { type: leitura.errorType, details: leitura.reason, err: leitura.err };
        }
        fluxoCelular.delete(phone);
        if (chatId) {
          aguardandoMac.add(chatId);
          aguardandoMacAgente.set(chatId, { phone, nome: nomeNewBR, fluxo: "CELULAR" });
        }
        await replyBot(msg, phone, nomeNewBR, MSG_OCR_FALHA_AGUARDANDO_AGENTE);
      }
      return finish();
    }
    return finish();
  }

  const comando = texto.toUpperCase();
  const token = comando.startsWith("#") ? comando.split(/\\s+/)[0] : "";
  // Comandos iniciados com "#" sao exclusivos do AGENTE (mensagens fromMe).
  // Cliente pode enviar "#..." mas o bot deve ignorar completamente (sem acionar fluxo).
  if (token) return finish();

  if (estadoLazer) {
    const handledLazer = await handleFluxoLazerMensagem(msg, phone, textoLower);
    if (handledLazer) return finish();
  }

  const handledFluxoCelular = await handleFluxoCelular(msg, phone, nome, textoLower);
  if (handledFluxoCelular) return finish();

  return finish();
}

const AUTH_PATH = process.env.WWEB_AUTH_PATH || ".wwebjs_auth";
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  }
});

client.on("qr", (qr) => {
  touchActivity();
  latestQr = qr;
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qr)}`;
  logger.info("QR Code gerado. Abra o link abaixo para escanear em qualquer dispositivo (copie e cole no navegador):");
  logger.info(qrImgUrl);
  logger.info(`Opcional (se tiver acesso local): http://localhost:${QR_PORT}/qr`);
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  touchActivity();
  logger.info("Cliente WhatsApp conectado e pronto para receber mensagens.");
  followUpService.setSender(async (rec, message) => {
    const ctx = {
      contactType: "CONTATO",
      name: (rec?.clientName || "").trim(),
      phoneE164: (rec?.clientPhone || "").trim(),
      chatId: rec?.chatId || "",
      origin: "BOT"
    };

    markBotSent(rec.chatId, message);
    const sent = await client.sendMessage(rec.chatId, message);
    const id = sent?.id?._serialized;
    if (id) botSentMessageIds.add(id);
    logger.messageSent(ctx, message);
    return sent;
  });
  followUpService.tick().catch((err) => logger.error("[FollowUp] Tick inicial falhou", err));
});

client.on("message", async (msg) => {
  touchActivity();

  const isFromMe = !!msg.fromMe;
  const msgId = getSerializedMessageId(msg);

  // Evita logar/processar respostas do BOT ou mensagens de agente já tratadas
  if (isFromMe) {
    if (msgId && botSentMessageIds.has(msgId)) {
      botSentMessageIds.delete(msgId);
      return;
    }
    const fpKeyOut = `${msg?.to || msg?.from || ""}|${(msg?.body || "").trim()}`;
    const fpExpOut = botSentFingerprints.get(fpKeyOut);
    if (fpExpOut) {
      botSentFingerprints.delete(fpKeyOut);
      if (fpExpOut > Date.now()) return;
    }
    if (msgId && agentProcessedMessageIds.has(msgId)) return;

    const contentAgent = formatConteudoParaLog(msg);
    let result = null;
    let errorForLog = null;

    try {
      result = await processAgentMessage(msg);
    } catch (err) {
      errorForLog = { type: "PROCESS_ERROR", details: err?.message || "Falha ao processar comando do agente", err };
      logger.error("Erro ao processar mensagem (AGENTE)", err);
    }

    const ctx = result?.ctx || {
      contactType: resolveTipoContato(null, msg?.to || msg?.from || ""),
      name: "",
      phoneE164: normalizeToE164BR(msg?.to || msg?.from || "") || "",
      chatId: msg?.to || msg?.from || "",
      origin: "AGENTE"
    };
    const content = result?.content || contentAgent;
    const errBlock = errorForLog || result?.errorForLog ? { error: errorForLog || result?.errorForLog } : {};
    logger.messageSent(ctx, content, errBlock);
    if (msgId) agentProcessedMessageIds.add(msgId);
    return;
  }

  const content = formatConteudoParaLog(msg);
  try {
    const result = await processMessage(msg);
    logger.messageReceived(result.ctx, content, result.errorForLog ? { error: result.errorForLog } : {});
  } catch (err) {
    logger.error("Erro ao processar mensagem", err);
    const chatId = msg?.from || "";
    const fallbackCtx = {
      contactType: resolveTipoContato(null, chatId),
      name: "",
      phoneE164: normalizeToE164BR(chatId) || "",
      chatId,
      origin: "CLIENTE"
    };
    logger.messageReceived(fallbackCtx, content, {
      error: { type: "PROCESS_ERROR", details: err?.message || "Falha ao processar mensagem", err }
    });
  }
});

// Log estruturado para mensagens enviadas pela prÃ³pria conta
client.on("message_create", async (msg) => {
  if (!msg.fromMe) return;
  touchActivity();

  const msgId = msg?.id?._serialized;
  if (msgId && botSentMessageIds.has(msgId)) {
    botSentMessageIds.delete(msgId);
    return;
  }

  const corpo = (msg.body || "").trim();
  const corpoUpper = corpo.toUpperCase();

  const fpKey = `${msg?.to || ""}|${corpo}`;
  const fpExp = botSentFingerprints.get(fpKey);
  if (fpExp) {
    botSentFingerprints.delete(fpKey);
    if (fpExp > Date.now()) return;
  }

  const targetChatId = msg?.to || "";
  const agentMsgId = getSerializedMessageId(msg);
  if (agentMsgId && agentProcessedMessageIds.has(agentMsgId)) return;

  let ctxToLog = null;
  let contentToLog = null;
  let errorForLog = null;

  try {
    const result = await processAgentMessage(msg);
    ctxToLog = result?.ctx || null;
    contentToLog = result?.content || null;
    errorForLog = result?.errorForLog || null;
  } catch (err) {
    errorForLog = { type: "PROCESS_ERROR", details: err?.message || "Falha ao processar comando do agente", err };
    logger.error("Erro ao processar message_create (AGENTE)", err);
  } finally {
    const fallbackCtx = ctxToLog || {
      contactType: resolveTipoContato(null, targetChatId),
      name: "",
      phoneE164: normalizeToE164BR(targetChatId) || "",
      chatId: targetChatId,
      origin: "AGENTE"
    };
    const fallbackContent = contentToLog || (corpo || "<sem texto>");
    logger.messageSent(fallbackCtx, fallbackContent, errorForLog ? { error: errorForLog } : {});
    if (agentMsgId) agentProcessedMessageIds.add(agentMsgId);
  }
});

client.initialize();

// Servidor simples para exibir o QR em pagina web
app.get("/", (_req, res) => res.redirect("/qr"));
app.get("/qr", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>QR WhatsApp</title>
    <meta http-equiv="refresh" content="6" />
    <style>
      body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .card { background: #1e293b; padding: 24px 28px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); text-align: center; }
      #qrcode { margin: 16px auto; }
      .info { font-size: 14px; color: #cbd5e1; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Escaneie o QR do WhatsApp</h2>
      <div id="qrcode"></div>
      <div class="info">A pÃ¡gina atualiza a cada 6s enquanto um novo QR estiver disponÃ­vel.</div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>
      const qrData = ${JSON.stringify(latestQr || "")};
      if (qrData) {
        new QRCode(document.getElementById("qrcode"), {
          text: qrData,
          width: 280,
          height: 280
        });
      } else {
        document.getElementById("qrcode").innerHTML = "<p>QR ainda nÃ£o gerado.</p>";
      }
    </script>
  </body>
</html>`;
  res.send(html);
});

app.get("/qr.json", (_req, res) => {
  res.json({ qr: latestQr || null });
});

app.listen(QR_PORT, () => {
  logger.info(`Servidor de QR em http://localhost:${QR_PORT}/qr`);
});

// Ping periÃ³dico opcional para manter o serviÃ§o acordado (defina SELF_PING_URL)
function startKeepAlive() {
  if (!SELF_PING_URL) {
    logger.info("Keep-alive desativado (defina SELF_PING_URL para habilitar).");
    return;
  }
  const interval = Number(process.env.SELF_PING_INTERVAL_MS || 240000); // default 4 min
  logger.info(`Keep-alive ligado: ping em ${SELF_PING_URL} a cada ${interval} ms`);
  setInterval(() => {
    axios
      .get(SELF_PING_URL)
      .then(() => logger.info("Keep-alive ping OK"))
      .catch((err) => logger.warn("Keep-alive falhou", { message: err?.message }));
  }, interval);
}

startKeepAlive();

// Log de ociosidade: se ficar sem eventos por IDLE_LOG_MS, imprime aviso
setInterval(() => {
  const agora = Date.now();
  if (agora - lastActivity >= IDLE_LOG_MS) {
    logger.info("Aguardando mensagens...");
    touchActivity();
  }
}, Math.max(60000, Math.min(IDLE_LOG_MS, 300000))); // checa entre 1 e 5 minutos
