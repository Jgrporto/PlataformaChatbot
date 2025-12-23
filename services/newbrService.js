import axios from "axios";
import { logTestRun } from "../src/db/repositories/tests.js";
import { closeConversation, updateConversationFlow } from "../src/db/repositories/conversations.js";

const NEWBR_URL =
  process.env.NEWBR_URL ||
  "https://painel.newbr.top/api/chatbot/ywDmJeJWpR/o231qzL4qz";

const NEWBR_AUTH_USER = process.env.NEWBR_AUTH_USER || "vendaiptv";
const NEWBR_AUTH_PASS = process.env.NEWBR_AUTH_PASS || "suporte+TV1";

export function buildObservations({ flowLabel }) {
  const label = (flowLabel || "").trim();
  return [
    "Gerado com ChatBot",
    `App: ${label || ""}`.trimEnd(),
    "IP: 162.220.234.126",
    "User-Agent: +TVBot"
  ].join("\n");
}

export async function criarTesteNewBR({
  appName,
  devicePhone,
  clientName,
  clientWhatsappE164,
  flowLabel,
  deviceId
}) {
  const observations = buildObservations({ flowLabel });

  const payload = {
    appName,
    messageDateTime: Math.floor(Date.now() / 1000),
    devicePhone,
    deviceName: "Emex Device",
    senderMessage: observations,
    senderPhone: clientWhatsappE164,
    userAgent: "+TVBot",
    customerWhatsapp: clientWhatsappE164
  };

  if (clientName) {
    payload.senderName = clientName;
    payload.customerName = clientName;
  }

  let responseData = null;
  let status = "success";
  let errorText = null;
  let shouldClose = false;

  try {
    const res = await axios.post(NEWBR_URL, payload, {
      headers: { "Content-Type": "application/json" },
      auth: { username: NEWBR_AUTH_USER, password: NEWBR_AUTH_PASS }
    });
    responseData = res?.data || null;
    shouldClose = true;
    return res?.data?.reply || "";
  } catch (err) {
    status = "error";
    errorText = err?.message || "request_failed";
    throw err;
  } finally {
    try {
      await logTestRun(
        {
          deviceId: deviceId || null,
          flow: flowLabel || appName || null,
          payload,
          response: responseData,
          status,
          errorText
        },
        null
      );
      if (shouldClose && clientWhatsappE164) {
        await updateConversationFlow(
          {
            deviceId: deviceId || null,
            phone: clientWhatsappE164,
            flow: flowLabel || appName || null,
            stage: "teste_gerado"
          },
          null
        );
      }
      if (shouldClose && clientWhatsappE164) {
        await closeConversation({ deviceId: deviceId || null, phone: clientWhatsappE164 }, null);
      }
    } catch {
      // ignore logging errors
    }
  }
}

