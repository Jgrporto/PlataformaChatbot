export function registerDeviceRoutes(app, { deviceManager, requireAuth }) {
  app.get("/api/devices", requireAuth, async (_req, res) => {
    const devices = await deviceManager.listDevices();
    res.json(devices);
  });

  app.post("/api/devices", requireAuth, async (req, res) => {
    try {
      const created = await deviceManager.createDevice(req.body || {});
      res.status(201).json(created);
    } catch (err) {
      res.status(400).send(err?.message || "Erro ao criar dispositivo.");
    }
  });

  app.get("/api/devices/:id/qr", requireAuth, async (req, res) => {
    const qr = deviceManager.getQr(req.params.id);
    if (!qr) return res.status(404).send("QR nao encontrado.");
    res.json({ qr });
  });

  app.post("/api/devices/:id/reconnect", requireAuth, async (req, res) => {
    try {
      const device = await deviceManager.reconnectDevice(req.params.id);
      if (!device) return res.status(404).send("Dispositivo nao encontrado.");
      res.json(device);
    } catch (err) {
      res.status(500).send(err?.message || "Erro ao reconectar.");
    }
  });

  app.delete("/api/devices/:id", requireAuth, async (req, res) => {
    try {
      const ok = await deviceManager.removeDevice(req.params.id);
      if (!ok) return res.status(404).send("Dispositivo nao encontrado.");
      res.status(204).end();
    } catch (err) {
      res.status(500).send(err?.message || "Erro ao remover.");
    }
  });
}
