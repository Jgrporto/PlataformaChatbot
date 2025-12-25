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

export function registerChatbotRoutes(app, { configService, commandsService, requireAuth }) {
  app.get("/api/chatbot/commands", requireAuth, async (req, res) => {
    const data = await configService.getCommands({ includeDisabled: true, deviceId: req.query.deviceId || null });
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

  app.get("/api/chatbot/quick-replies", requireAuth, async (req, res) => {
    const data = await configService.getQuickReplies({
      includeDisabled: true,
      deviceId: req.query.deviceId || null
    });
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

  app.get("/api/chatbot/variables", requireAuth, async (req, res) => {
    const data = await configService.getVariables({ deviceId: req.query.deviceId || null });
    res.json(data);
  });

  app.post("/api/chatbot/variables", requireAuth, async (req, res) => {
    try {
      const created = await configService.createVariable(req.body || {});
      res.status(201).json(created);
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.put("/api/chatbot/variables/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).send("ID invalido.");
    try {
      const updated = await configService.updateVariable(id, req.body || {});
      res.json(updated);
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.delete("/api/chatbot/variables/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).send("ID invalido.");
    try {
      await configService.deleteVariable(id);
      res.status(204).end();
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.get("/api/chatbot/flows", requireAuth, async (req, res) => {
    const data = await configService.getFlows({ includeDisabled: true, deviceId: req.query.deviceId || null });
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

  app.get("/api/chatbot/agent-commands", requireAuth, async (req, res) => {
    try {
      const data = await commandsService.list({
        includeDisabled: true,
        deviceId: req.query.deviceId || null
      });
      res.json(data);
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.post("/api/chatbot/agent-commands", requireAuth, async (req, res) => {
    try {
      const created = await commandsService.create(req.body || {});
      res.status(201).json(created);
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.put("/api/chatbot/agent-commands/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).send("ID invalido.");
    try {
      const updated = await commandsService.update(id, req.body || {});
      res.json(updated);
    } catch (err) {
      handleChatbotError(res, err);
    }
  });

  app.delete("/api/chatbot/agent-commands/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).send("ID invalido.");
    try {
      await commandsService.delete(id);
      res.status(204).end();
    } catch (err) {
      handleChatbotError(res, err);
    }
  });
}
