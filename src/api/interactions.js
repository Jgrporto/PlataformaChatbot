import { listInteractions, getContactHistory } from "../db/repositories/interactions.js";

export function registerInteractionRoutes(app, { requireAuth, logger }) {
  app.get("/api/interactions", requireAuth, async (req, res) => {
    try {
      const data = await listInteractions(
        {
          from: req.query.from,
          to: req.query.to,
          q: req.query.q,
          deviceId: req.query.deviceId
        },
        logger
      );
      res.json(data);
    } catch (err) {
      res.status(500).send(err?.message || "Erro ao listar interacoes.");
    }
  });

  app.get("/api/contacts/:phone/history", requireAuth, async (req, res) => {
    try {
      const data = await getContactHistory(req.params.phone, logger);
      res.json(data);
    } catch (err) {
      res.status(500).send(err?.message || "Erro ao buscar historico.");
    }
  });
}
