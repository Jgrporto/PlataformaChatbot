import session from "express-session";

const ADMIN_USER = process.env.ADMIN_USER || "Porto";
const ADMIN_PASS = process.env.ADMIN_PASS || "senhadobot";

export function setupAuth(app, { logger } = {}) {
  const secret = process.env.SESSION_SECRET || "change-me";
  app.use(
    session({
      secret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax" }
    })
  );

  app.post("/api/login", (req, res) => {
    if (!ADMIN_USER || !ADMIN_PASS) {
      return res.status(500).send("ADMIN_USER/ADMIN_PASS nao configurado.");
    }
    const { username, password } = req.body || {};
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      req.session.user = { username };
      return res.json({ ok: true, username });
    }
    logger?.warn?.("[AUTH] Tentativa de login invalida");
    return res.status(401).send("Credenciais invalidas.");
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.get("/api/me", (req, res) => {
    if (!req.session?.user) return res.status(401).send("Nao autenticado.");
    return res.json({ ok: true, user: req.session.user });
  });

  return function requireAuth(req, res, next) {
    if (req.session?.user) return next();
    return res.status(401).send("Nao autenticado.");
  };
}
