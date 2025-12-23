const state = {
  devices: [],
  commands: [],
  replies: [],
  flows: [],
  interactions: [],
  tests: []
};

const views = {
  devices: {
    title: "Dispositivos",
    subtitle: "Gerencie sessoes WhatsApp e QR."
  },
  chatbot: {
    title: "Chatbot",
    subtitle: "Comandos, respostas rapidas e fluxos configuraveis."
  },
  interactions: {
    title: "Interacoes",
    subtitle: "Auditoria de mensagens e fluxos por contato."
  },
  tests: {
    title: "Testes API",
    subtitle: "Execucoes registradas da API NewBR."
  }
};

const el = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));

const modal = el("modal");
const modalTitle = el("modal-title");
const modalBody = el("modal-body");
const loginScreen = el("login-screen");
const loginHint = el("login-hint");
const userChip = el("user-chip");
const wsStatus = el("ws-status");
let qrPoller = null;
let qrCountdown = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Erro na API");
  }
  if (res.status === 204) return null;
  return res.json();
}

function showModal(title, content) {
  modalTitle.textContent = title || "";
  modalBody.innerHTML = "";
  if (typeof content === "string") {
    modalBody.innerHTML = content;
  } else if (content) {
    modalBody.appendChild(content);
  }
  modal.classList.remove("hidden");
}

function hideModal() {
  modal.classList.add("hidden");
  modalBody.innerHTML = "";
  if (qrPoller) {
    clearInterval(qrPoller);
    qrPoller = null;
  }
  if (qrCountdown) {
    clearInterval(qrCountdown);
    qrCountdown = null;
  }
}

function setView(view) {
  qsa(".view").forEach((node) => node.classList.remove("active"));
  el(`view-${view}`).classList.add("active");
  qsa(".nav-btn").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  el("view-title").textContent = views[view].title;
  el("view-subtitle").textContent = views[view].subtitle;
}

function formatDate(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

function formatStatus(status) {
  if (!status) return "disconnected";
  return status;
}

async function loadDevices() {
  state.devices = await api("/api/devices");
  renderDevices();
  updateDeviceSelects();
}

function renderDevices() {
  const filter = el("device-filter").value.toLowerCase();
  const grid = el("device-grid");
  grid.innerHTML = "";

  const filtered = state.devices.filter((device) => {
    const text = `${device.name} ${device.status}`.toLowerCase();
    return !filter || text.includes(filter);
  });

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "device-card";
    empty.textContent = "Nenhuma sessao encontrada.";
    grid.appendChild(empty);
    return;
  }

  filtered.forEach((device) => {
    const card = document.createElement("div");
    card.className = "device-card";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = device.name || device.id;

    const status = document.createElement("div");
    const statusValue = formatStatus(device.status);
    status.className = `status ${statusValue}`;
    status.textContent = statusValue.replace("_", " ");

    const meta = document.createElement("div");
    meta.className = "device-meta";
    meta.textContent = `Ultima atividade: ${formatDate(device.lastActivity)}`;

    let qrBox = null;
    if (device.qrImage) {
      qrBox = document.createElement("div");
      qrBox.className = "qr-preview";
      const img = document.createElement("img");
      img.src = device.qrImage;
      img.alt = "QR";
      qrBox.appendChild(img);
    }

    const actions = document.createElement("div");
    actions.className = "form-row";

    const qrBtn = document.createElement("button");
    qrBtn.className = "secondary";
    qrBtn.textContent = "QR";
    qrBtn.addEventListener("click", () => openQrModal(device));

    const reconnect = document.createElement("button");
    reconnect.className = "secondary";
    reconnect.textContent = "Reconectar";
    reconnect.addEventListener("click", () => reconnectDevice(device.id));

    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Remover";
    remove.addEventListener("click", () => deleteDevice(device.id));

    actions.append(qrBtn, reconnect, remove);
    if (qrBox) {
      card.append(title, status, meta, qrBox, actions);
    } else {
      card.append(title, status, meta, actions);
    }
    grid.appendChild(card);
  });
}

async function openQrModal(device) {
  if (qrPoller) {
    clearInterval(qrPoller);
    qrPoller = null;
  }
  if (qrCountdown) {
    clearInterval(qrCountdown);
    qrCountdown = null;
  }

  const box = document.createElement("div");
  box.className = "qr-modal";

  const info = document.createElement("div");
  info.className = "qr-info";

  const qrTitle = document.createElement("div");
  qrTitle.className = "qr-title";
  qrTitle.textContent = "Escaneie o QR abaixo.";

  const qrNotice = document.createElement("div");
  qrNotice.className = "qr-notice";
  qrNotice.textContent = "QR ativo por 2 minutos.";

  const qrTimer = document.createElement("div");
  qrTimer.className = "qr-timer";
  qrTimer.textContent = "02:00";

  info.append(qrTitle, qrNotice, qrTimer);

  const qrBox = document.createElement("div");
  qrBox.className = "qr-box";

  const qrStatus = document.createElement("div");
  qrStatus.className = "qr-status";
  qrStatus.textContent = "Gerando QR...";

  const qrActions = document.createElement("div");
  qrActions.className = "form-row qr-actions";

  let lastQrValue = device.qr || null;
  let qrImage = device.qrImage || null;
  let qrIssuedAt = device.qrIssuedAt || null;
  let reconnectTriggered = false;
  let qrExpiresAt = null;

  const regenerate = document.createElement("button");
  regenerate.className = "secondary";
  regenerate.textContent = "Gerar novo QR";
  regenerate.addEventListener("click", async () => {
    qrStatus.textContent = "Gerando QR...";
    qrBox.classList.remove("expired");
    qrBox.innerHTML = "";
    lastQrValue = null;
    qrImage = null;
    qrIssuedAt = null;
    qrExpiresAt = null;
    reconnectTriggered = true;
    if (qrCountdown) {
      clearInterval(qrCountdown);
      qrCountdown = null;
    }
    try {
      await api(`/api/devices/${device.id}/reconnect`, { method: "POST" });
    } catch {
      // ignore
    }
    await refreshQr();
  });

  qrActions.appendChild(regenerate);
  box.append(info, qrBox, qrStatus, qrActions);
  showModal(`QR - ${device.name}`, box);

  function formatCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function updateCountdown() {
    if (!qrExpiresAt) {
      qrTimer.textContent = "02:00";
      return;
    }
    const remaining = qrExpiresAt - Date.now();
    qrTimer.textContent = formatCountdown(remaining);
    if (remaining <= 0) {
      qrStatus.textContent = "QR expirado. Clique em Gerar novo QR.";
      qrBox.classList.add("expired");
    }
  }

  function setExpiry(issuedAt) {
    const parsed = issuedAt ? new Date(issuedAt).getTime() : Date.now();
    const base = Number.isNaN(parsed) ? Date.now() : parsed;
    qrExpiresAt = base + 2 * 60 * 1000;
    if (qrCountdown) clearInterval(qrCountdown);
    qrCountdown = setInterval(updateCountdown, 1000);
    updateCountdown();
  }

  function renderQr(imageUrl) {
    if (!imageUrl) return;
    qrBox.innerHTML = "";
    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = "QR";
    qrBox.appendChild(img);
  }

  async function refreshQr() {
    let data = null;
    try {
      data = await api(`/api/devices/${device.id}/qr`);
    } catch {
      data = null;
    }

    const nextQr = data?.qr || null;
    const nextImage = data?.imageUrl || null;
    const nextIssuedAt = data?.issuedAt || null;

    if (nextQr && nextImage) {
      const shouldUpdate = !lastQrValue || nextQr !== lastQrValue || !qrImage || !qrExpiresAt;
      if (shouldUpdate) {
        lastQrValue = nextQr;
        qrImage = nextImage;
        qrIssuedAt = nextIssuedAt || new Date().toISOString();
        qrBox.classList.remove("expired");
        qrStatus.textContent = "Escaneie o QR abaixo.";
        renderQr(qrImage);
        setExpiry(qrIssuedAt);
      }
      return;
    }

    if (!lastQrValue) {
      qrStatus.textContent = reconnectTriggered ? "Gerando QR..." : "QR ainda nao gerado.";
      if (!reconnectTriggered) {
        try {
          await api(`/api/devices/${device.id}/reconnect`, { method: "POST" });
          reconnectTriggered = true;
        } catch {
          // ignore
        }
      }
    }
  }

  if (qrImage) {
    qrStatus.textContent = "Escaneie o QR abaixo.";
    renderQr(qrImage);
    setExpiry(qrIssuedAt);
  }

  await refreshQr();
  qrPoller = setInterval(refreshQr, 4000);
}

async function createDevice() {
  const name = el("device-name").value.trim();
  if (!name) return;
  await api("/api/devices", { method: "POST", body: JSON.stringify({ name }) });
  el("device-name").value = "";
  await loadDevices();
}

async function reconnectDevice(id) {
  await api(`/api/devices/${id}/reconnect`, { method: "POST" });
  await loadDevices();
}

async function deleteDevice(id) {
  if (!confirm("Remover esta sessao?")) return;
  await api(`/api/devices/${id}`, { method: "DELETE" });
  await loadDevices();
}

async function loadChatbot() {
  const [commands, replies, flows] = await Promise.all([
    api("/api/chatbot/commands"),
    api("/api/chatbot/quick-replies"),
    api("/api/chatbot/flows")
  ]);
  state.commands = commands || [];
  state.replies = replies || [];
  state.flows = flows || [];
  renderCommands();
  renderReplies();
  renderFlows();
}

function renderCommands() {
  const table = el("commands-table");
  table.innerHTML = "";
  const flowOptions = state.flows.map((flow) => flow.name);
  el("new-command-flow").innerHTML = flowOptions
    .map((flow) => `<option value="${flow}">${flow}</option>`)
    .join("");

  state.commands.forEach((cmd) => {
    const row = document.createElement("div");
    row.className = "table-row";

    const token = document.createElement("input");
    token.className = "input";
    token.value = cmd.token || "";

    const flow = document.createElement("select");
    flow.className = "input";
    flow.innerHTML = flowOptions
      .map((flowName) => `<option value="${flowName}">${flowName}</option>`)
      .join("");
    flow.value = cmd.flow || "";

    const enabledWrap = document.createElement("label");
    enabledWrap.className = "toggle";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = !!cmd.enabled;
    enabledWrap.append(enabled, document.createTextNode("Ativo"));

    const actions = document.createElement("div");
    actions.className = "form-row";
    const save = document.createElement("button");
    save.className = "secondary";
    save.textContent = "Salvar";
    save.addEventListener("click", async () => {
      await api(`/api/chatbot/commands/${cmd.id}`, {
        method: "PUT",
        body: JSON.stringify({ token: token.value, flow: flow.value, enabled: enabled.checked })
      });
      await loadChatbot();
    });
    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Excluir";
    remove.addEventListener("click", async () => {
      if (!confirm("Excluir comando?")) return;
      await api(`/api/chatbot/commands/${cmd.id}`, { method: "DELETE" });
      await loadChatbot();
    });
    actions.append(save, remove);

    row.append(token, flow, enabledWrap, actions);
    table.appendChild(row);
  });
}

async function createCommand() {
  const token = el("new-command-token").value.trim();
  const flow = el("new-command-flow").value;
  const enabled = el("new-command-enabled").checked;
  if (!token) return;
  await api("/api/chatbot/commands", { method: "POST", body: JSON.stringify({ token, flow, enabled }) });
  el("new-command-token").value = "";
  await loadChatbot();
}

function renderReplies() {
  const table = el("replies-table");
  table.innerHTML = "";

  state.replies.forEach((item) => {
    const row = document.createElement("div");
    row.className = "table-row compact";

    const trigger = document.createElement("input");
    trigger.className = "input";
    trigger.value = item.trigger || "";

    const response = document.createElement("input");
    response.className = "input";
    response.value = item.response || "";

    const match = document.createElement("select");
    match.className = "input";
    match.innerHTML =
      "<option value='includes'>Contem</option><option value='exact'>Igual</option><option value='starts_with'>Comeca</option>";
    match.value = item.matchType || "includes";

    const actions = document.createElement("div");
    actions.className = "form-row";
    const save = document.createElement("button");
    save.className = "secondary";
    save.textContent = "Salvar";
    save.addEventListener("click", async () => {
      await api(`/api/chatbot/quick-replies/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({
          trigger: trigger.value,
          response: response.value,
          matchType: match.value,
          enabled: item.enabled
        })
      });
      await loadChatbot();
    });
    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Excluir";
    remove.addEventListener("click", async () => {
      if (!confirm("Excluir resposta rapida?")) return;
      await api(`/api/chatbot/quick-replies/${item.id}`, { method: "DELETE" });
      await loadChatbot();
    });
    actions.append(save, remove);

    row.append(trigger, response, match, actions);
    table.appendChild(row);
  });
}

async function createReply() {
  const trigger = el("new-reply-trigger").value.trim();
  const response = el("new-reply-response").value.trim();
  const matchType = el("new-reply-match").value;
  if (!trigger || !response) return;
  await api("/api/chatbot/quick-replies", { method: "POST", body: JSON.stringify({ trigger, response, matchType }) });
  el("new-reply-trigger").value = "";
  el("new-reply-response").value = "";
  await loadChatbot();
}

function renderFlows() {
  const table = el("flows-table");
  table.innerHTML = "";

  state.flows.forEach((flow) => {
    const row = document.createElement("div");
    row.className = "table-row flow";

    const name = document.createElement("div");
    name.textContent = flow.name || "";

    const triggers = document.createElement("div");
    triggers.textContent = `${flow.triggers?.length || 0} gatilhos`;
    triggers.className = "device-meta";

    const stages = document.createElement("div");
    stages.textContent = `${flow.stages?.length || 0} etapas`;
    stages.className = "device-meta";

    const actions = document.createElement("div");
    actions.className = "form-row";
    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => openFlowEditor(flow));
    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Excluir";
    remove.addEventListener("click", async () => {
      if (!confirm("Excluir fluxo?")) return;
      await api(`/api/chatbot/flows/${flow.id}`, { method: "DELETE" });
      await loadChatbot();
    });
    actions.append(edit, remove);

    row.append(name, triggers, stages, actions);
    table.appendChild(row);
  });
}

async function createFlow() {
  const name = el("new-flow-name").value.trim();
  if (!name) return;
  await api("/api/chatbot/flows", { method: "POST", body: JSON.stringify({ name, triggers: [], stages: [] }) });
  el("new-flow-name").value = "";
  await loadChatbot();
}

function openFlowEditor(flow) {
  const wrapper = document.createElement("div");
  const name = document.createElement("input");
  name.className = "input";
  name.value = flow.name || "";

  const triggers = document.createElement("textarea");
  triggers.className = "input";
  triggers.rows = 4;
  triggers.value = JSON.stringify(flow.triggers || [], null, 2);

  const stages = document.createElement("textarea");
  stages.className = "input";
  stages.rows = 6;
  stages.value = JSON.stringify(flow.stages || [], null, 2);

  const enabled = document.createElement("label");
  enabled.className = "toggle";
  const enabledInput = document.createElement("input");
  enabledInput.type = "checkbox";
  enabledInput.checked = !!flow.enabled;
  enabled.append(enabledInput, document.createTextNode("Ativo"));

  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Salvar";
  save.addEventListener("click", async () => {
    let triggersParsed = [];
    let stagesParsed = [];
    try {
      triggersParsed = JSON.parse(triggers.value || "[]");
      stagesParsed = JSON.parse(stages.value || "[]");
    } catch {
      alert("JSON invalido em gatilhos ou etapas.");
      return;
    }
    await api(`/api/chatbot/flows/${flow.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: name.value,
        triggers: triggersParsed,
        stages: stagesParsed,
        enabled: enabledInput.checked,
        flowType: flow.flowType || "custom"
      })
    });
    hideModal();
    await loadChatbot();
  });

  wrapper.append(
    document.createTextNode("Nome"),
    name,
    document.createTextNode("Gatilhos (JSON)"),
    triggers,
    document.createTextNode("Etapas (JSON)"),
    stages,
    enabled,
    save
  );
  showModal(`Editar fluxo ${flow.name}`, wrapper);
}

async function loadInteractions() {
  const params = new URLSearchParams();
  const q = el("interaction-q").value.trim();
  const from = el("interaction-from").value;
  const to = el("interaction-to").value;
  const deviceId = el("interaction-device").value;
  if (q) params.set("q", q);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (deviceId) params.set("deviceId", deviceId);
  state.interactions = await api(`/api/interactions?${params.toString()}`);
  renderInteractions();
}

function renderInteractions() {
  const list = el("interaction-list");
  list.innerHTML = "";
  if (!state.interactions.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.textContent = "Nenhuma interacao encontrada.";
    list.appendChild(empty);
    return;
  }
  state.interactions.forEach((item) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.addEventListener("click", () => openHistory(item.phone || item.chatId, item.name));
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `${item.name || "Sem nome"} (${item.phone || "-"})`;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${item.eventType || "evento"} | ${item.flow || "-"} | ${formatDate(item.createdAt)}`;
    const content = document.createElement("div");
    content.className = "meta";
    content.textContent = item.content || "-";
    row.append(title, meta, content);
    list.appendChild(row);
  });
}

async function openHistory(phone, name) {
  if (!phone) return;
  const data = await api(`/api/contacts/${encodeURIComponent(phone)}/history`);
  const wrapper = document.createElement("div");
  wrapper.appendChild(document.createTextNode(`Contato: ${name || "-"} (${phone})`));
  data.forEach((msg) => {
    const row = document.createElement("div");
    row.className = "list-item";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `${msg.origin || "-"} | ${formatDate(msg.createdAt)}`;
    const body = document.createElement("div");
    body.className = "meta";
    body.textContent = msg.content || "-";
    row.append(title, body);
    wrapper.appendChild(row);
  });
  showModal("Historico do contato", wrapper);
}

async function loadTests() {
  const params = new URLSearchParams();
  const status = el("tests-status").value;
  const from = el("tests-from").value;
  const to = el("tests-to").value;
  const deviceId = el("tests-device").value;
  if (status) params.set("status", status);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (deviceId) params.set("deviceId", deviceId);
  state.tests = await api(`/api/tests?${params.toString()}`);
  renderTests();
}

function renderTests() {
  const list = el("tests-list");
  list.innerHTML = "";
  if (!state.tests.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.textContent = "Nenhum teste registrado.";
    list.appendChild(empty);
    return;
  }
  state.tests.forEach((test) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.addEventListener("click", () => openTest(test));
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `#${test.id} ${test.flow || "-"} (${test.status || "-"})`;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${formatDate(test.createdAt)} | ${test.deviceId || "sem device"}`;
    row.append(title, meta);
    list.appendChild(row);
  });
}

function openTest(test) {
  const wrapper = document.createElement("div");
  const payload = document.createElement("pre");
  payload.textContent = JSON.stringify(test.payload || {}, null, 2);
  const response = document.createElement("pre");
  response.textContent = JSON.stringify(test.response || {}, null, 2);
  const error = document.createElement("div");
  if (test.errorText) {
    error.textContent = `Erro: ${test.errorText}`;
  }
  wrapper.append(
    document.createTextNode("Payload"),
    payload,
    document.createTextNode("Resposta"),
    response,
    error
  );
  showModal(`Teste #${test.id}`, wrapper);
}

function updateDeviceSelects() {
  const options = ["<option value=\"\">Todos</option>"].concat(
    state.devices.map((d) => `<option value="${d.id}">${d.name || d.id}</option>`)
  );
  el("interaction-device").innerHTML = options.join("");
  el("tests-device").innerHTML = options.join("");
}

async function checkAuth() {
  try {
    const me = await api("/api/me");
    userChip.textContent = me.user?.username || "admin";
    loginScreen.classList.add("hidden");
  } catch (err) {
    loginScreen.classList.remove("hidden");
  }
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  wsStatus.textContent = "WS: conectando";

  ws.addEventListener("open", () => {
    wsStatus.textContent = "WS: online";
  });
  ws.addEventListener("close", () => {
    wsStatus.textContent = "WS: offline";
    setTimeout(connectWs, 4000);
  });
  ws.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type?.startsWith("device.")) {
        loadDevices().catch(() => {});
      }
      if (payload.type === "interaction.new" && qs("#view-interactions").classList.contains("active")) {
        loadInteractions().catch(() => {});
      }
    } catch {
      // ignore
    }
  });
}

el("modal-close").addEventListener("click", hideModal);
modal.addEventListener("click", (ev) => {
  if (ev.target === modal) hideModal();
});

qsa(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    setView(view);
    if (view === "devices") loadDevices().catch(() => {});
    if (view === "chatbot") loadChatbot().catch(() => {});
    if (view === "interactions") loadInteractions().catch(() => {});
    if (view === "tests") loadTests().catch(() => {});
  });
});

el("device-filter").addEventListener("input", renderDevices);
el("create-device").addEventListener("click", () => createDevice().catch((err) => alert(err.message)));
el("create-command").addEventListener("click", () => createCommand().catch((err) => alert(err.message)));
el("create-reply").addEventListener("click", () => createReply().catch((err) => alert(err.message)));
el("create-flow").addEventListener("click", () => createFlow().catch((err) => alert(err.message)));
el("interaction-refresh").addEventListener("click", () => loadInteractions().catch((err) => alert(err.message)));
el("tests-refresh").addEventListener("click", () => loadTests().catch((err) => alert(err.message)));

el("logout-btn").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    // ignore
  }
  loginScreen.classList.remove("hidden");
});

el("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  loginHint.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: el("login-user").value,
        password: el("login-pass").value
      })
    });
    loginScreen.classList.add("hidden");
    await loadDevices();
    setView("devices");
  } catch (err) {
    loginHint.textContent = err.message || "Falha no login.";
  }
});

async function init() {
  await checkAuth();
  await loadDevices();
  setView("devices");
  connectWs();
  setInterval(() => {
    if (qs("#view-devices").classList.contains("active")) {
      loadDevices().catch(() => {});
    }
    if (qs("#view-interactions").classList.contains("active")) {
      loadInteractions().catch(() => {});
    }
    if (qs("#view-tests").classList.contains("active")) {
      loadTests().catch(() => {});
    }
  }, 6000);
}

init().catch(() => {
  loginScreen.classList.remove("hidden");
});
