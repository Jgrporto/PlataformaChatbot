import axios from "axios";

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
  flowLabel
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

  const res = await axios.post(NEWBR_URL, payload, {
    headers: { "Content-Type": "application/json" },
    auth: { username: NEWBR_AUTH_USER, password: NEWBR_AUTH_PASS }
  });

  return res?.data?.reply || "";
}

