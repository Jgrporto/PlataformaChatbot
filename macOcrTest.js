import fs from "fs";
import path from "path";
import { extractMacFromImageBuffer } from "./services/ocrService.js";
import { logger } from "./utils/logger.js";

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    logger.error("Uso: node macOcrTest.js caminho/para/imagem.jpg");
    process.exit(1);
  }

  const filePath = path.resolve(fileArg);
  const exists = fs.existsSync(filePath);
  if (!exists) {
    logger.error(`Arquivo nao encontrado: ${filePath}`);
    process.exit(1);
  }

  const buffer = await fs.promises.readFile(filePath);
  logger.info(`Lendo imagem: ${filePath}`, { bytes: buffer.length });

  const res = await extractMacFromImageBuffer(buffer);
  if (res.ok) {
    logger.info(`MAC detectado: ${res.mac}`);
    return;
  }

  logger.warn("Nenhum MAC valido detectado via OCR", {
    errorType: res.errorType,
    details: res.details,
    extractedText: (res.extractedText || "").trim().slice(0, 300)
  });
  process.exit(2);
}

main().catch((err) => {
  logger.error("Falha no teste de OCR", err);
  process.exit(1);
});

