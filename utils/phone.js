function digitsOnly(raw) {
  return (raw || "").toString().replace(/[^\d]/g, "");
}

export function normalizeToE164BR(raw) {
  const digits = digitsOnly(raw);
  if (!digits) return null;

  // WhatsApp IDs podem carregar sufixos (ex.: @c.us / @g.us) e outros números (ex.: grupos).
  // Regras práticas: aceitar 10/11 dígitos (DDD+numero) ou 12/13 dígitos (55+DDD+numero).
  if (digits.startsWith("55")) {
    if (digits.length === 12 || digits.length === 13) return `+${digits}`;
    return null;
  }

  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return null;
}

export function normalizeChatIdToE164(chatId) {
  return normalizeToE164BR(chatId);
}

export function ensureChatIdFromE164(e164) {
  const digits = digitsOnly(e164);
  if (!digits) return null;
  return `${digits}@c.us`;
}

export function safeE164OrFallback(e164, fallbackRaw) {
  return normalizeToE164BR(e164) || normalizeToE164BR(fallbackRaw) || null;
}

