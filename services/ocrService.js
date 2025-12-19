import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Tesseract from "tesseract.js";

const MAC_COLON_REGEX = /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const OCR_ROTATE_AUTO_FALLBACK = (process.env.OCR_ROTATE_AUTO_FALLBACK || "1") !== "0";
const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SERVICE_DIR, "..");

function normalizeOcrText(text, aggressive = false) {
  let out = (text || "").replace(/\bMAC\b\s*[:=\-]?\s*/gi, " ");
  if (!aggressive) {
    return out.replace(/[O]/g, "0").replace(/[Il]/g, "1");
  }

  return out
    .replace(/[OoQq]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[Gg]/g, "6")
    .replace(/[Tt]/g, "7");
}

function findMacCandidates(cleaned, scoreText = "") {
  if (!cleaned.trim()) return null;

  const macRegex = /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}[\s:\-._]){5}[0-9A-Fa-f]{2}/g;
  const looseRegex = /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}[^0-9A-Fa-f]{0,2}){5}[0-9A-Fa-f]{2}/g;
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

  const looseMatches = cleaned.match(looseRegex);
  if (looseMatches?.length) looseMatches.forEach(pushCandidate);

  const contiguous = cleaned.match(contiguousRegex);
  if (contiguous?.length) contiguous.forEach(pushCandidate);

  if (!candidates.length) return null;

  const upper = (scoreText || cleaned).toUpperCase();
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

export function extractMacFromText(text) {
  const raw = text || "";
  const cleaned = normalizeOcrText(raw, false);
  let mac = findMacCandidates(cleaned, raw);
  if (mac) return mac;

  const aggressive = normalizeOcrText(raw, true);
  if (aggressive !== cleaned) {
    mac = findMacCandidates(aggressive, raw);
  }

  return mac || null;
}

function resolveLangPath() {
  const prefix = (process.env.TESSDATA_PREFIX || "").trim();
  const resolvedPrefix = prefix ? path.resolve(prefix) : "";
  const candidates = [];

  if (resolvedPrefix) {
    candidates.push(
      resolvedPrefix.toLowerCase().endsWith(".traineddata") ? path.dirname(resolvedPrefix) : resolvedPrefix
    );
  }

  candidates.push(process.cwd(), PROJECT_ROOT);

  const seen = new Set();
  for (const dir of candidates) {
    if (!dir) continue;
    const normalized = path.resolve(dir);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const localTraineddata = path.join(normalized, "eng.traineddata");
    if (fs.existsSync(localTraineddata)) return normalized;
  }

  return undefined;
}

function buildOcrOptions(extraConfig = null) {
  const langPath = resolveLangPath();
  const options = {};

  if (langPath) options.langPath = langPath;
  if (extraConfig) Object.assign(options, extraConfig);

  return Object.keys(options).length ? options : undefined;
}

export async function extractMacFromImageBuffer(imageBuffer) {
  try {
    const baseOptions = buildOcrOptions();
    const ocr = await Tesseract.recognize(imageBuffer, "eng", baseOptions);
    const text = ocr?.data?.text || "";

    let mac = extractMacFromText(text);
    let fallbackText = "";
    let usedFallback = false;
    let usedRotateAuto = false;

    if (!mac) {
      const fallbackOptions = buildOcrOptions({
        tessedit_char_whitelist: "0123456789ABCDEFabcdef:",
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: "6",
        rotateAuto: OCR_ROTATE_AUTO_FALLBACK
      });

      const ocrFallback = await Tesseract.recognize(imageBuffer, "eng", fallbackOptions);
      fallbackText = ocrFallback?.data?.text || "";
      usedFallback = true;
      usedRotateAuto = OCR_ROTATE_AUTO_FALLBACK;
      mac = extractMacFromText(fallbackText || text);
    }

    if (!mac) {
      const base = (fallbackText || text || "").trim();
      const hasText = !!base;
      return {
        ok: false,
        errorType: hasText ? "OCR_NO_MAC" : "OCR_NO_TEXT",
        details: hasText ? "Texto extraido, mas sem padrao de MAC" : "OCR vazio (sem texto legivel)",
        extractedText: base,
        usedFallback,
        usedRotateAuto
      };
    }

    return { ok: true, mac, extractedText: fallbackText || text, usedFallback, usedRotateAuto };
  } catch (err) {
    return {
      ok: false,
      errorType: "OCR_ERROR",
      details: err?.message || "Falha tecnica no OCR",
      extractedText: "",
      err
    };
  }
}
