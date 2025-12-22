import { WebSocketServer } from "ws";

export function setupRealtime(server, { logger } = {}) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const clients = new Set();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });

  function broadcast(type, payload) {
    const message = JSON.stringify({ type, payload, ts: new Date().toISOString() });
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  wss.on("error", (err) => logger?.error?.("[WS] Erro no WebSocket", err));

  return { wss, broadcast };
}
