function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function handleChatbotError(res, err) {
  const message = err?.message || "Erro interno.";
  if (message.includes("INVALIDO") || message.includes("INVALIDA")) {
    return res.status(400).send(message);
  }
  if (message.toLowerCase().includes("unique")) {
    return res.status(409).send(message);
  }
  return res.status(500).send(message);
}

export function registerChatbotRoutes(app, { configService, requireAuth }) {
  app.get("/api/chatbot/commands", requireAuth, async (_req, res) => {
    const data = await configService.getCommands({ includeDisabled: true });
    res.json(data);
  });

  app.post("/api/chatbot/commands", requireAuth, async (req, res) => {
    try {
      const created = await configService.createCommand(req.body || {});
      res.status(201).json(created);
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.put("/api/chatbot/commands/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).send("ID invalido.");
    try {
      const updated = await configService.updateCommand(id, req.body || {});
      res.json(updated);
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.delete("/api/chatbot/commands/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).send("ID invalido.");
    try {
      await configService.deleteCommand(id);
      res.status(204).end();
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.get("/api/chatbot/quick-replies", requireAuth, async (_req, res) => {
    const data = await configService.getQuickReplies({ includeDisabled: true });
    res.json(data);
  });

  app.post("/api/chatbot/quick-replies", requireAuth, async (req, res) => {
    try {
      const created = await configService.createQuickReply(req.body || {});
      res.status(201).json(created);
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.put("/api/chatbot/quick-replies/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).send("ID invalido.");
    try {
      const updated = await configService.updateQuickReply(id, req.body || {});
      res.json(updated);
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.delete("/api/chatbot/quick-replies/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).send("ID invalido.");
    try {
      await configService.deleteQuickReply(id);
      res.status(204).end();
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.get("/api/chatbot/flows", requireAuth, async (_req, res) => {
    const data = await configService.getFlows({ includeDisabled: true });
    res.json(data);
  });

  app.post("/api/chatbot/flows", requireAuth, async (req, res) => {
    try {
      const created = await configService.createFlow(req.body || {});
      res.status(201).json(created);
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.put("/api/chatbot/flows/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).send("ID invalido.");
    try {
      const updated = await configService.updateFlow(id, req.body || {});
      res.json(updated);
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.delete("/api/chatbot/flows/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).send("ID invalido.");
    try {
      await configService.deleteFlow(id);
      res.status(204).end();
    } catch (err) {
      handleChatbotError(res, err);
    }
  });
}
