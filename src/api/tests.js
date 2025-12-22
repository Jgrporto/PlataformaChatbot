import { listTests, getTestById } from "../db/repositories/tests.js";

export function registerTestRoutes(app, { requireAuth, logger }) {
  app.get("/api/tests", requireAuth, async (req, res) => {
    try {
      const data = await listTests(
        {
          status: req.query.status,
          from: req.query.from,
          to: req.query.to,
          deviceId: req.query.deviceId
        },
        logger
      );
      res.json(data);
    } catch (err) {
      res.status(500).send(err?.message || "Erro ao listar testes.");
    }
  });

  app.get("/api/tests/:id", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).send("ID invalido.");
    try {
      const test = await getTestById(id, logger);
      if (!test) return res.status(404).send("Teste nao encontrado.");
      res.json(test);
    } catch (err) {
      res.status(500).send(err?.message || "Erro ao buscar teste.");
    }
  });
}
