export function registerFollowupRoutes(app, { requireAuth, followUpService }) {
  app.get("/api/followups", requireAuth, (_req, res) => {
    const items = followUpService.list();
    res.json(items);
  });

  app.patch("/api/followups/:id", requireAuth, async (req, res) => {
    const id = req.params.id;
    const deviceId = req.body?.deviceId ?? null;
    const sessionName = req.body?.sessionName ?? null;
    try {
      const updated = await followUpService.updateRecord(id, { deviceId, sessionName });
      if (!updated) return res.status(404).send("Follow-up nao encontrado.");
      res.json(updated);
    } catch (err) {
      res.status(500).send(err?.message || "Erro ao atualizar follow-up.");
    }
  });
}
