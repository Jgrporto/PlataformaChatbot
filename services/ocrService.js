import fs from "fs";
import path from "path";
import { createWorker, OEM } from "tesseract.js";

const MAC_COLON_REGEX = /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/;

function sanitizeOcrText(text) {
  return (text || "")
    .replace(/\bMAC\b\s*[:=\-]?\s*/gi, " ")
    .replace(/[O]/g, "0")
    .replace(/[Il]/g, "1");
}

export function extractMacFromText(text) {
  const cleaned = sanitizeOcrText(text);
  if (!cleaned.trim()) return null;

  const macRegex = /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}[\s:\-._]){5}[0-9A-Fa-f]{2}/g;
  const contiguousRegex = /[0-9A-Fa-f]{12,14}/g;

  const candidates = [];

  const pushCandidate = (raw) => {
    if (!raw) return;
    let mac = raw.replace(/[^0-9A-F]/gi, "").toUpperCase();
    if (mac.length < 12) return;
    if (mac.length > 12) mac = mac.slice(0, 12);
    const normalized = mac.match(/.{2}/g)?.join(":") || "";
    if (MAC_COLON_REGEX.test(normalized)) candidates.push(normalized);
  };

  const matches = cleaned.match(macRegex);
  if (matches?.length) matches.forEach(pushCandidate);

  const contiguous = cleaned.match(contiguousRegex);
  if (contiguous?.length) contiguous.forEach(pushCandidate);

  if (!candidates.length) return null;

  const upper = cleaned.toUpperCase();
  const macIndex = upper.indexOf("MAC");
  const score = (mac) => {
    const pos = upper.indexOf(mac);
    let s = 0;
    if (pos >= 0) s += 1;
    if (mac.length === 17) s += 3;
    if (pos >= 0 && macIndex >= 0) s += Math.max(0, 5 - Math.abs(pos - macIndex) / 5);
    return s;
  };

  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] || null;
}

let workerPromise = null;

async function getWorker() {
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    const prefix = (process.env.TESSDATA_PREFIX || "").trim();
    const resolvedPrefix = prefix ? path.resolve(prefix) : "";
    const isFilePrefix = resolvedPrefix && resolvedPrefix.toLowerCase().endsWith(".traineddata");
    const langDirCandidate = isFilePrefix ? path.dirname(resolvedPrefix) : (resolvedPrefix || process.cwd());

    const localTraineddata = path.join(langDirCandidate, "eng.traineddata");
    const langPath = fs.existsSync(localTraineddata) ? langDirCandidate : undefined;

    // IMPORTANTE: em `tesseract.js@5` o `createWorker` recebe (langs, oem, options, config).
    // Se passarmos o "options" como 1º argumento, o worker tenta tratar como langs e quebra
    // com erros do tipo `langsArr.map is not a function`.
    const worker = await createWorker(
      "eng",
      OEM.LSTM_ONLY,
      {
        langPath,
        cachePath: path.resolve(process.cwd(), ".tesseract-cache"),
        errorHandler: () => {
          // Evita crash do processo (o erro segue via reject e é tratado pelo caller).
        }
      }
    );

    await worker.load();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");

    return worker;
  })();

  return workerPromise;
}

export async function extractMacFromImageBuffer(imageBuffer) {
  try {
    const worker = await getWorker();

    await worker.setParameters({
      tessedit_char_whitelist: "0123456789ABCDEFabcdef:-._ ",
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6"
    });

    const result = await worker.recognize(imageBuffer);
    const text = result?.data?.text || "";

    if (!text.trim()) {
      return {
        ok: false,
        errorType: "OCR_NO_TEXT",
        details: "OCR sem texto extraído",
        extractedText: ""
      };
    }

    const mac = extractMacFromText(text);
    if (!mac) {
      return {
        ok: false,
        errorType: "OCR_NO_MAC",
        details: "Texto extraído, mas sem padrão de MAC",
        extractedText: text
      };
    }

    return { ok: true, mac, extractedText: text };
  } catch (err) {
    return {
      ok: false,
      errorType: "OCR_ERROR",
      details: err?.message || "Falha técnica no OCR",
      extractedText: "",
      err
    };
  }
}
