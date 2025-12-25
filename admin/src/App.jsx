import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, { Background, Controls, MiniMap } from "reactflow";

const VIEWS = [
  {
    id: "dashboard",
    title: "Dashboard",
    subtitle: "Visao geral dos dispositivos e conversas."
  },
  {
    id: "devices",
    title: "Dispositivos",
    subtitle: "Gerencie sessoes WhatsApp e QR sob demanda."
  },
  {
    id: "chatbot",
    title: "Chatbot",
    subtitle: "Comandos # e respostas rapidas por dispositivo."
  },
  {
    id: "variables",
    title: "Variaveis",
    subtitle: "Gerencie variaveis para usar em {#nome_da_variavel}."
  },
  {
    id: "flows",
    title: "Flows",
    subtitle: "Em breve: modelos e editor de fluxos."
  },
  {
    id: "conversations",
    title: "Conversas",
    subtitle: "Contatos ativos, timeline de fluxo e envio de mensagens."
  },
  {
    id: "tests",
    title: "Testes API",
    subtitle: "Execucoes registradas da API NewBR."
  },
  {
    id: "followups",
    title: "Follow-ups",
    subtitle: "Reatribua dispositivos e acompanhe retornos."
  }
];

const DASHBOARD_RANGES = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Ultimos 7 dias" },
  { value: "30d", label: "Ultimos 30 dias" }
];

const REPLY_PAGE_SIZE = 6;

const MATCH_LABELS = {
  includes: "Contem",
  exact: "Frase exata",
  starts_with: "Comeca",
  list: "Lista"
};

const PRESET_VARIABLES = [
  {
    name: "nome",
    label: "Nome do contato",
    source: "Contato do WhatsApp (nome do cliente)."
  },
  {
    name: "telefone",
    label: "Telefone do contato",
    source: "WhatsApp do cliente no formato E.164."
  },
  {
    name: "usuario",
    label: "Usuario do teste",
    source: "Extraido do retorno do NewBR (texto ou URL)."
  },
  {
    name: "senha",
    label: "Senha do teste",
    source: "Extraido do retorno do NewBR (texto ou URL)."
  },
  {
    name: "http1",
    label: "Primeiro link HTTP",
    source: "Primeiro link encontrado no retorno do NewBR."
  },
  {
    name: "http2",
    label: "Segundo link HTTP",
    source: "Segundo link encontrado no retorno do NewBR."
  }
];

const EMPTY_QR_MODAL = {
  open: false,
  device: null,
  status: "disconnected",
  imageUrl: null,
  issuedAt: null,
  expiresAt: null,
  connected: false,
  message: "",
  waiting: false
};

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

function formatDate(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

function formatStatus(value) {
  return (value || "disconnected").toString();
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildDeviceLabel(device) {
  if (!device) return "Device";
  const phone = device.devicePhone ? ` (${device.devicePhone})` : "";
  return `${device.name || device.id}${phone}`;
}

function getMatchLabel(value) {
  return MATCH_LABELS[value] || value || "Custom";
}

function getStageText(stage) {
  if (typeof stage === "string") return stage;
  if (!stage || typeof stage !== "object") return "";
  return stage.message || stage.text || stage.label || stage.title || "";
}

function buildFlowGraph(flow) {
  const stages = Array.isArray(flow?.stages) ? flow.stages : [];
  const nodes = stages.map((stage, index) => {
    const raw = getStageText(stage);
    const text = (raw || "").trim();
    const label = text.length > 90 ? `${text.slice(0, 87)}...` : text;
    return {
      id: `stage-${index}`,
      position: { x: 0, y: index * 120 },
      data: {
        label: (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Etapa {index + 1}</div>
            <div className="device-meta">{label || "Sem conteudo"}</div>
          </div>
        )
      },
      className: "flow-node"
    };
  });

  const edges = stages.slice(1).map((_, index) => ({
    id: `edge-${index}`,
    source: `stage-${index}`,
    target: `stage-${index + 1}`,
    type: "smoothstep"
  }));

  return { nodes, edges };
}

function parseJsonArray(value) {
  const raw = (value || "").trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON precisa ser uma lista");
  }
  return parsed;
}

function getRangeStart(range) {
  const now = new Date();
  if (range === "today") {
    now.setHours(0, 0, 0, 0);
    return now;
  }
  const days = range === "30d" ? 30 : 7;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function buildDailySeries(items, range, predicate) {
  const days = range === "30d" ? 30 : range === "today" ? 1 : 7;
  const buckets = new Map();

  items
    .filter(predicate)
    .forEach((item) => {
      const date = new Date(item.createdAt || Date.now());
      if (Number.isNaN(date.getTime())) return;
      date.setHours(0, 0, 0, 0);
      const key = date.toISOString().slice(0, 10);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    });

  const labels = [];
  const values = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const current = new Date();
    current.setHours(0, 0, 0, 0);
    current.setDate(current.getDate() - i);
    const key = current.toISOString().slice(0, 10);
    values.push(buckets.get(key) || 0);
    labels.push(
      current.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit"
      })
    );
  }

  return { labels, values };
}

function App() {
  const [auth, setAuth] = useState({ status: "checking", user: null });
  const [loginForm, setLoginForm] = useState({ username: "", password: "", error: "" });
  const [activeView, setActiveView] = useState(VIEWS[0].id);
  const [dashboardRange, setDashboardRange] = useState("7d");

  const [devices, setDevices] = useState([]);
  const [deviceFilter, setDeviceFilter] = useState("");
  const [newDeviceName, setNewDeviceName] = useState("");
  const [wsStatus, setWsStatus] = useState("offline");

  const [qrModal, setQrModal] = useState(EMPTY_QR_MODAL);
  const [qrRemaining, setQrRemaining] = useState(120000);
  const wsRef = useRef(null);
  const wsReconnectRef = useRef(null);

  const [chatbotDeviceId, setChatbotDeviceId] = useState("");
  const [agentCommands, setAgentCommands] = useState([]);
  const [replies, setReplies] = useState([]);
  const [flows, setFlows] = useState([]);
  const [variables, setVariables] = useState([]);
  const [variablesDeviceId, setVariablesDeviceId] = useState("");
  const [variablesQuery, setVariablesQuery] = useState("");
  const [newAgentCommand, setNewAgentCommand] = useState({
    trigger: "",
    responseTemplate: "",
    commandType: "test",
    enabled: true,
    deviceId: ""
  });
  const [newReply, setNewReply] = useState({
    trigger: "",
    response: "",
    matchType: "includes",
    enabled: true,
    deviceId: ""
  });
  const [newFlow, setNewFlow] = useState({
    name: "",
    triggers: "[]",
    stages: "[]",
    flowType: "custom",
    enabled: true,
    deviceId: ""
  });
  const [chatbotQuery, setChatbotQuery] = useState("");
  const [chatbotSearchMode, setChatbotSearchMode] = useState("trigger");
  const [chatbotMatchFilter, setChatbotMatchFilter] = useState("");
  const [replyPage, setReplyPage] = useState(1);
  const [expandedReplyId, setExpandedReplyId] = useState(null);
  const [expandedCommandId, setExpandedCommandId] = useState(null);
  const [expandedVariableId, setExpandedVariableId] = useState(null);
  const [chatbotModalOpen, setChatbotModalOpen] = useState(false);
  const [chatbotModalMode, setChatbotModalMode] = useState("select");
  const [editingReplyId, setEditingReplyId] = useState(null);
  const [editingCommandId, setEditingCommandId] = useState(null);
  const [variableModalOpen, setVariableModalOpen] = useState(false);
  const [editingVariableId, setEditingVariableId] = useState(null);
  const [newVariable, setNewVariable] = useState({ name: "", value: "", deviceId: "" });
  const [flowEditorOpen, setFlowEditorOpen] = useState(false);
  const [flowTriggerInput, setFlowTriggerInput] = useState("");
  const [flowJsonOpen, setFlowJsonOpen] = useState(false);
  const [flowRuleState, setFlowRuleState] = useState({
    anyMessage: false,
    keywordMessage: true,
    firstMessageDay: false,
    firstMessage: false,
    allowGroups: false,
    scheduleOnly: false,
    ignoreOpen: false,
    customSignature: false,
    simulateTyping: true,
    crmIgnore: false,
    crmIgnoreAll: false,
    crmOnly: false,
    tagIgnore: false,
    tagIgnoreAll: false,
    tagOnly: false
  });
  const [flowCreateOpen, setFlowCreateOpen] = useState(false);
  const [selectedFlowId, setSelectedFlowId] = useState(null);
  const [flowDraft, setFlowDraft] = useState({
    name: "",
    triggers: "[]",
    stages: "[]",
    flowType: "custom",
    enabled: true,
    deviceId: ""
  });
  const [flowError, setFlowError] = useState("");

  const [conversations, setConversations] = useState([]);
  const [conversationFilters, setConversationFilters] = useState({ q: "", status: "", deviceId: "" });
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [conversationDetails, setConversationDetails] = useState(null);
  const [conversationMessage, setConversationMessage] = useState("");
  const [conversationDeviceId, setConversationDeviceId] = useState("");

  const [tests, setTests] = useState([]);
  const [testsFilters, setTestsFilters] = useState({ status: "", from: "", to: "", deviceId: "" });

  const [followups, setFollowups] = useState([]);
  const [interactions, setInteractions] = useState([]);

  const [detailModal, setDetailModal] = useState({ open: false, title: "", content: null });

  const viewMeta = useMemo(() => VIEWS.find((view) => view.id === activeView) || VIEWS[0], [activeView]);
  const deviceOptions = useMemo(
    () => devices.map((device) => ({ value: device.id, label: buildDeviceLabel(device) })),
    [devices]
  );
  const presetVariableNames = useMemo(
    () => new Set(PRESET_VARIABLES.map((item) => item.name)),
    []
  );
  const deviceLabelMap = useMemo(() => {
    const map = new Map();
    devices.forEach((device) => {
      map.set(device.id, buildDeviceLabel(device));
    });
    return map;
  }, [devices]);
  const selectedFlow = useMemo(
    () => flows.find((flow) => flow.id === selectedFlowId) || null,
    [flows, selectedFlowId]
  );
  const replyStats = useMemo(() => {
    const total = replies.length;
    const active = replies.filter((reply) => reply.enabled).length;
    return { total, active, inactive: total - active };
  }, [replies]);
  const commandStats = useMemo(() => {
    const total = agentCommands.length;
    const active = agentCommands.filter((command) => command.enabled).length;
    const tests = agentCommands.filter((command) => command.commandType === "test").length;
    return { total, active, inactive: total - active, tests };
  }, [agentCommands]);
  const filteredReplies = useMemo(() => {
    let data = replies;
    if (chatbotMatchFilter) {
      data = data.filter((reply) => reply.matchType === chatbotMatchFilter);
    }
    if (chatbotQuery.trim()) {
      const query = chatbotQuery.trim().toLowerCase();
      data = data.filter((reply) => {
        const target = chatbotSearchMode === "response" ? reply.response : reply.trigger;
        return (target || "").toLowerCase().includes(query);
      });
    }
    return data;
  }, [replies, chatbotQuery, chatbotSearchMode, chatbotMatchFilter]);
  const filteredVariables = useMemo(() => {
    let data = variables;
    if (variablesQuery.trim()) {
      const query = variablesQuery.trim().toLowerCase();
      data = data.filter((item) => {
        const name = (item.name || "").toLowerCase();
        const value = (item.value || "").toLowerCase();
        return name.includes(query) || value.includes(query);
      });
    }
    return data;
  }, [variables, variablesQuery]);
  const replyPageCount = useMemo(() => {
    return Math.max(1, Math.ceil(filteredReplies.length / REPLY_PAGE_SIZE));
  }, [filteredReplies.length]);
  const pagedReplies = useMemo(() => {
    const start = (replyPage - 1) * REPLY_PAGE_SIZE;
    return filteredReplies.slice(start, start + REPLY_PAGE_SIZE);
  }, [filteredReplies, replyPage]);
  const flowTriggerList = useMemo(() => {
    try {
      return parseJsonArray(flowDraft.triggers);
    } catch {
      return [];
    }
  }, [flowDraft.triggers]);
  const flowStageParsed = useMemo(() => {
    try {
      return { stages: parseJsonArray(flowDraft.stages), error: "" };
    } catch (err) {
      return { stages: [], error: err.message || "JSON invalido" };
    }
  }, [flowDraft.stages]);
  const flowEditorGraph = useMemo(() => {
    if (!flowEditorOpen) return { nodes: [], edges: [] };
    return buildFlowGraph({ stages: flowStageParsed.stages });
  }, [flowEditorOpen, flowStageParsed.stages]);
  const dashboardStats = useMemo(() => {
    const totalDevices = devices.length;
    const connectedDevices = devices.filter((device) => device.status === "connected").length;
    const totalConversations = conversations.length;
    const openConversations = conversations.filter((convo) => convo.status === "open").length;
    const totalTests = tests.length;
    const testErrors = tests.filter((test) => test.status === "error").length;
    const totalMessages = interactions.filter((event) =>
      ["message_received", "message_sent"].includes(event.eventType)
    ).length;
    const pendingSchedules = followups.length;
    const contacts = new Set(conversations.map((convo) => convo.phone).filter(Boolean)).size;
    return {
      totalDevices,
      connectedDevices,
      totalConversations,
      openConversations,
      totalTests,
      testErrors,
      totalMessages,
      pendingSchedules,
      contacts
    };
  }, [devices, conversations, tests, interactions, followups]);
  const messageSeries = useMemo(
    () =>
      buildDailySeries(interactions, dashboardRange, (event) =>
        ["message_received", "message_sent"].includes(event.eventType)
      ),
    [interactions, dashboardRange]
  );
  const autoReplySeries = useMemo(
    () =>
      buildDailySeries(
        interactions,
        dashboardRange,
        (event) => event.origin === "BOT" && event.eventType === "message_sent"
      ),
    [interactions, dashboardRange]
  );
  const donutData = useMemo(() => {
    const chatbot = interactions.filter((event) => event.origin === "BOT").length;
    const api = tests.length;
    const scheduled = followups.length;
    const listResponse = interactions.filter(
      (event) => event.origin === "AGENTE" && event.eventType === "message_sent"
    ).length;
    return [
      { label: "Chatbot", value: chatbot, color: "#22c55e" },
      { label: "API", value: api, color: "#f97316" },
      { label: "Mensagem Agendada", value: scheduled, color: "#8b5cf6" },
      { label: "list-message-response", value: listResponse, color: "#0ea5e9" }
    ];
  }, [interactions, tests, followups]);
  const donutTotal = useMemo(
    () => donutData.reduce((acc, item) => acc + (Number(item.value) || 0), 0),
    [donutData]
  );
  const donutGradient = useMemo(() => {
    if (!donutTotal) return "conic-gradient(#1f2937 0deg 360deg)";
    let acc = 0;
    const parts = donutData.map((item) => {
      const portion = ((Number(item.value) || 0) / donutTotal) * 360;
      const start = acc;
      const end = acc + portion;
      acc = end;
      return `${item.color} ${start}deg ${end}deg`;
    });
    return `conic-gradient(${parts.join(", ")})`;
  }, [donutData, donutTotal]);
  const deviceStats = useMemo(() => {
    return devices.map((device) => {
      const messageCount = interactions.filter((event) => event.deviceId === device.id).length;
      return { ...device, messageCount };
    });
  }, [devices, interactions]);
  const linePoints = useMemo(() => {
    const values = messageSeries.values;
    if (!values.length) return "";
    const max = Math.max(...values, 1);
    const width = 320;
    const height = 120;
    const padX = 10;
    const padY = 10;
    return values
      .map((value, index) => {
        const x = values.length === 1 ? width / 2 : padX + (index / (values.length - 1)) * (width - padX * 2);
        const y = height - padY - (value / max) * (height - padY * 2);
        return `${x},${y}`;
      })
      .join(" ");
  }, [messageSeries.values]);
  const barMax = useMemo(() => {
    return Math.max(...autoReplySeries.values, 1);
  }, [autoReplySeries.values]);

  const checkAuth = useCallback(async () => {
    try {
      const me = await api("/api/me");
      setAuth({ status: "ready", user: me.user || null });
    } catch {
      setAuth({ status: "login", user: null });
    }
  }, []);

  const loadDevices = useCallback(async () => {
    const data = await api("/api/devices");
    setDevices(Array.isArray(data) ? data : []);
  }, []);

  const loadChatbot = useCallback(async () => {
    const params = new URLSearchParams();
    if (chatbotDeviceId) params.set("deviceId", chatbotDeviceId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const [cmd, rep] = await Promise.all([
      api(`/api/chatbot/agent-commands${suffix}`),
      api(`/api/chatbot/quick-replies${suffix}`)
    ]);
    setAgentCommands(cmd || []);
    setReplies(rep || []);
  }, [chatbotDeviceId]);

  const loadVariables = useCallback(async () => {
    const params = new URLSearchParams();
    if (variablesDeviceId) params.set("deviceId", variablesDeviceId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const data = await api(`/api/chatbot/variables${suffix}`);
    setVariables(data || []);
  }, [variablesDeviceId]);

  const loadFlows = useCallback(async () => {
    const params = new URLSearchParams();
    if (chatbotDeviceId) params.set("deviceId", chatbotDeviceId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const data = await api(`/api/chatbot/flows${suffix}`);
    setFlows(data || []);
  }, [chatbotDeviceId]);

  const loadConversations = useCallback(async () => {
    const params = new URLSearchParams();
    if (conversationFilters.q) params.set("q", conversationFilters.q);
    if (conversationFilters.status) params.set("status", conversationFilters.status);
    if (conversationFilters.deviceId) params.set("deviceId", conversationFilters.deviceId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const data = await api(`/api/conversations${suffix}`);
    setConversations(data || []);
  }, [conversationFilters]);

  const loadConversationDetails = useCallback(async (id) => {
    if (!id) return;
    const data = await api(`/api/conversations/${id}`);
    setConversationDetails(data || null);
    setConversationDeviceId(data?.deviceId || "");
  }, []);

  const loadTests = useCallback(async () => {
    const params = new URLSearchParams();
    if (testsFilters.status) params.set("status", testsFilters.status);
    if (testsFilters.from) params.set("from", testsFilters.from);
    if (testsFilters.to) params.set("to", testsFilters.to);
    if (testsFilters.deviceId) params.set("deviceId", testsFilters.deviceId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const data = await api(`/api/tests${suffix}`);
    setTests(data || []);
  }, [testsFilters]);

  const loadFollowups = useCallback(async () => {
    const data = await api("/api/followups");
    setFollowups(data || []);
  }, []);
  const loadInteractions = useCallback(async () => {
    const params = new URLSearchParams();
    const from = getRangeStart(dashboardRange);
    if (from) params.set("from", from.toISOString());
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const data = await api(`/api/interactions${suffix}`);
    setInteractions(data || []);
  }, [dashboardRange]);

  useEffect(() => {
    checkAuth().catch(() => {});
  }, [checkAuth]);

  useEffect(() => {
    if (auth.status !== "ready") return;
    loadDevices().catch(() => {});
  }, [auth.status, loadDevices]);

  useEffect(() => {
    if (auth.status !== "ready") return;
    if (activeView === "dashboard") {
      loadDevices().catch(() => {});
      loadConversations().catch(() => {});
      loadTests().catch(() => {});
      loadFollowups().catch(() => {});
      loadInteractions().catch(() => {});
    }
    if (activeView === "chatbot") loadChatbot().catch(() => {});
    if (activeView === "variables") loadVariables().catch(() => {});
    if (activeView === "flows") loadFlows().catch(() => {});
    if (activeView === "conversations") loadConversations().catch(() => {});
    if (activeView === "tests") loadTests().catch(() => {});
    if (activeView === "followups") loadFollowups().catch(() => {});
  }, [
    auth.status,
    activeView,
    loadDevices,
    loadChatbot,
    loadVariables,
    loadFlows,
    loadConversations,
    loadTests,
    loadFollowups,
    loadInteractions
  ]);

  useEffect(() => {
    if (auth.status !== "ready") return;
    const interval = setInterval(() => {
      if (activeView === "dashboard") {
        loadDevices().catch(() => {});
        loadConversations().catch(() => {});
        loadTests().catch(() => {});
        loadFollowups().catch(() => {});
        loadInteractions().catch(() => {});
      }
      if (activeView === "devices") loadDevices().catch(() => {});
      if (activeView === "chatbot") loadChatbot().catch(() => {});
      if (activeView === "variables") loadVariables().catch(() => {});
      if (activeView === "flows") loadFlows().catch(() => {});
      if (activeView === "conversations") loadConversations().catch(() => {});
      if (activeView === "tests") loadTests().catch(() => {});
      if (activeView === "followups") loadFollowups().catch(() => {});
    }, 6000);
    return () => clearInterval(interval);
  }, [
    auth.status,
    activeView,
    loadDevices,
    loadChatbot,
    loadVariables,
    loadFlows,
    loadConversations,
    loadTests,
    loadFollowups,
    loadInteractions
  ]);

  useEffect(() => {
    if (!activeConversationId) {
      setConversationDetails(null);
      return;
    }
    loadConversationDetails(activeConversationId).catch(() => {});
  }, [activeConversationId, loadConversationDetails]);

  useEffect(() => {
    if (!selectedFlowId && flows.length) {
      setSelectedFlowId(flows[0].id);
      return;
    }
    if (selectedFlowId && !flows.some((flow) => flow.id === selectedFlowId)) {
      setSelectedFlowId(flows[0]?.id || null);
    }
  }, [flows, selectedFlowId]);

  useEffect(() => {
    if (!selectedFlow) {
      setFlowDraft({
        name: "",
        triggers: "[]",
        stages: "[]",
        flowType: "custom",
        enabled: true,
        deviceId: ""
      });
      setFlowError("");
      return;
    }
    setFlowDraft({
      name: selectedFlow.name || "",
      triggers: JSON.stringify(selectedFlow.triggers || [], null, 2),
      stages: JSON.stringify(selectedFlow.stages || [], null, 2),
      flowType: selectedFlow.flowType || "custom",
      enabled: !!selectedFlow.enabled,
      deviceId: selectedFlow.deviceId || ""
    });
    setFlowError("");
  }, [selectedFlow]);

  useEffect(() => {
    setNewAgentCommand((prev) => ({ ...prev, deviceId: chatbotDeviceId || "" }));
    setNewReply((prev) => ({ ...prev, deviceId: chatbotDeviceId || "" }));
    setNewFlow((prev) => ({ ...prev, deviceId: chatbotDeviceId || "" }));
  }, [chatbotDeviceId]);

  useEffect(() => {
    setNewVariable((prev) => ({ ...prev, deviceId: variablesDeviceId || "" }));
  }, [variablesDeviceId]);

  useEffect(() => {
    setReplyPage(1);
    setExpandedReplyId(null);
    setExpandedCommandId(null);
  }, [chatbotQuery, chatbotSearchMode, chatbotMatchFilter, chatbotDeviceId]);

  useEffect(() => {
    if (replyPage > replyPageCount) {
      setReplyPage(replyPageCount);
    }
  }, [replyPage, replyPageCount]);

  useEffect(() => {
    if (!qrModal.open || !qrModal.device) return;
    const deviceId = qrModal.device.id;
    let active = true;

    const refresh = async () => {
      try {
        const data = await api(`/api/devices/${deviceId}/qr`);
        if (!active) return;
        const status = data?.status || "disconnected";
        if (status === "connected") {
          setQrModal((prev) => ({
            ...prev,
            status,
            connected: true,
            message: "CONECTADO! Pode fechar a tela."
          }));
          return;
        }

        const issuedAt = data?.issuedAt || null;
        const imageUrl = data?.imageUrl || null;
        setQrModal((prev) => {
          const next = { ...prev, status };
          if (imageUrl) {
            next.imageUrl = imageUrl;
            next.issuedAt = issuedAt || new Date().toISOString();
            next.connected = false;
            next.message = "Escaneie o QR abaixo.";
            const base = issuedAt ? new Date(issuedAt).getTime() : Date.now();
            next.expiresAt = Number.isNaN(base) ? Date.now() + 2 * 60 * 1000 : base + 2 * 60 * 1000;
          } else if (!prev.imageUrl) {
            next.message = status === "awaiting_qr" ? "Gerando QR..." : "QR ainda nao gerado.";
          }
          return next;
        });
      } catch {
        // ignore
      }
    };

    refresh();
    const poller = setInterval(refresh, 4000);
    return () => {
      active = false;
      clearInterval(poller);
    };
  }, [qrModal.open, qrModal.device]);

  useEffect(() => {
    if (!qrModal.open || !qrModal.expiresAt) {
      setQrRemaining(120000);
      return;
    }
    const tick = () => {
      setQrRemaining(Math.max(0, qrModal.expiresAt - Date.now()));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [qrModal.open, qrModal.expiresAt]);

  useEffect(() => {
    if (!qrModal.open || !qrModal.connected) return;
    const timer = setTimeout(() => {
      setQrModal(EMPTY_QR_MODAL);
    }, 1200);
    return () => clearTimeout(timer);
  }, [qrModal.open, qrModal.connected]);

  useEffect(() => {
    if (auth.status !== "ready") return;
    let alive = true;

    const connect = () => {
      if (!alive) return;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      wsRef.current = ws;
      setWsStatus("conectando");

      ws.addEventListener("open", () => setWsStatus("online"));
      ws.addEventListener("close", () => {
        setWsStatus("offline");
        if (alive) {
          wsReconnectRef.current = setTimeout(connect, 4000);
        }
      });
      ws.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type?.startsWith("device.")) {
            loadDevices().catch(() => {});
          }
        } catch {
          // ignore
        }
      });
    };

    connect();

    return () => {
      alive = false;
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  }, [auth.status, loadDevices]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginForm((prev) => ({ ...prev, error: "" }));
    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: loginForm.username,
          password: loginForm.password
        })
      });
      await checkAuth();
    } catch (err) {
      setLoginForm((prev) => ({ ...prev, error: err.message || "Falha no login." }));
    }
  };

  const handleLogout = async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setAuth({ status: "login", user: null });
  };

  const createDevice = async () => {
    const name = newDeviceName.trim();
    if (!name) return;
    try {
      await api("/api/devices", { method: "POST", body: JSON.stringify({ name }) });
      setNewDeviceName("");
      await loadDevices();
    } catch (err) {
      alert(err.message || "Erro ao criar dispositivo.");
    }
  };

  const reconnectDevice = async (id) => {
    try {
      await api(`/api/devices/${id}/reconnect`, { method: "POST" });
      await loadDevices();
    } catch (err) {
      alert(err.message || "Erro ao reconectar.");
    }
  };

  const deleteDevice = async (id) => {
    if (!confirm("Remover esta sessao?")) return;
    try {
      await api(`/api/devices/${id}`, { method: "DELETE" });
      await loadDevices();
    } catch (err) {
      alert(err.message || "Erro ao remover.");
    }
  };

  const openQrModal = async (device) => {
    setQrModal({
      ...EMPTY_QR_MODAL,
      open: true,
      device,
      status: device.status || "disconnected",
      message: "Gerando QR..."
    });
    try {
      await api(`/api/devices/${device.id}/qr`, { method: "POST" });
    } catch (err) {
      setQrModal((prev) => ({ ...prev, message: err.message || "Falha ao solicitar QR." }));
    }
  };

  const regenerateQr = async () => {
    if (!qrModal.device) return;
    setQrModal((prev) => ({
      ...prev,
      imageUrl: null,
      issuedAt: null,
      expiresAt: null,
      message: "Gerando QR..."
    }));
    try {
      await api(`/api/devices/${qrModal.device.id}/reconnect`, { method: "POST" });
    } catch (err) {
      setQrModal((prev) => ({ ...prev, message: err.message || "Falha ao gerar QR." }));
    }
  };

  const resetReplyForm = (overrides = {}) => {
    setNewReply({
      trigger: "",
      response: "",
      matchType: "includes",
      enabled: true,
      deviceId: chatbotDeviceId || "",
      ...overrides
    });
  };

  const openReplyModal = (reply = null) => {
    setChatbotModalMode("reply");
    setEditingCommandId(null);
    if (reply) {
      setEditingReplyId(reply.id);
      resetReplyForm({
        trigger: reply.trigger || "",
        response: reply.response || "",
        matchType: reply.matchType || "includes",
        enabled: !!reply.enabled,
        deviceId: reply.deviceId || ""
      });
    } else {
      setEditingReplyId(null);
      resetReplyForm();
    }
    setChatbotModalOpen(true);
  };

  const openChatbotModal = () => {
    setEditingCommandId(null);
    setEditingReplyId(null);
    resetReplyForm();
    setNewAgentCommand({
      trigger: "",
      responseTemplate: "",
      commandType: "test",
      enabled: true,
      deviceId: chatbotDeviceId || ""
    });
    setChatbotModalMode("select");
    setChatbotModalOpen(true);
  };

  const submitReplyForm = async () => {
    const success = editingReplyId
      ? await saveReply({ id: editingReplyId, ...newReply })
      : await createReply();
    if (success) {
      closeChatbotModal();
    }
  };

  const clearReplyFilters = () => {
    setChatbotQuery("");
    setChatbotSearchMode("trigger");
    setChatbotMatchFilter("");
    setChatbotDeviceId("");
  };

  const toggleReplyEnabled = async (reply) => {
    await saveReply({ ...reply, enabled: !reply.enabled });
  };

  const updateFlowTriggers = (next) => {
    setFlowDraft((prev) => ({ ...prev, triggers: JSON.stringify(next, null, 2) }));
  };

  const addFlowTrigger = () => {
    const value = flowTriggerInput.trim();
    if (!value) return;
    const next = Array.from(new Set([...flowTriggerList, value]));
    updateFlowTriggers(next);
    setFlowTriggerInput("");
  };

  const removeFlowTrigger = (value) => {
    updateFlowTriggers(flowTriggerList.filter((item) => item !== value));
  };

  const toggleFlowRule = (key) => {
    setFlowRuleState((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const openFlowEditor = (flow) => {
    setSelectedFlowId(flow.id);
    setFlowEditorOpen(true);
    setFlowTriggerInput("");
    setFlowJsonOpen(false);
    setFlowError("");
  };

  const closeFlowEditor = () => {
    setFlowEditorOpen(false);
  };

  const submitFlowCreate = async () => {
    const success = await createFlow();
    if (success) {
      setFlowCreateOpen(false);
    }
  };

  const openCommandModal = (command = null) => {
    setChatbotModalMode("command");
    setEditingReplyId(null);
    if (command) {
      setEditingCommandId(command.id);
      setNewAgentCommand({
        trigger: command.trigger || "",
        responseTemplate: command.responseTemplate || "",
        commandType: command.commandType || "reply",
        enabled: !!command.enabled,
        deviceId: command.deviceId || ""
      });
    } else {
      setEditingCommandId(null);
      setNewAgentCommand({
        trigger: "",
        responseTemplate: "",
        commandType: "test",
        enabled: true,
        deviceId: chatbotDeviceId || ""
      });
    }
    setChatbotModalOpen(true);
  };

  const closeChatbotModal = () => {
    setChatbotModalOpen(false);
    setEditingCommandId(null);
    setEditingReplyId(null);
    setChatbotModalMode("select");
  };

  const createAgentCommand = async () => {
    const trigger = newAgentCommand.trigger.trim();
    const responseTemplate = newAgentCommand.responseTemplate.trim();
    if (!trigger || !trigger.startsWith("#") || trigger.length <= 1) {
      alert("A frase precisa iniciar com #.");
      return false;
    }
    if (!responseTemplate) {
      alert("Resposta obrigatoria.");
      return false;
    }
    try {
      await api("/api/chatbot/agent-commands", {
        method: "POST",
        body: JSON.stringify({
          trigger,
          responseTemplate,
          commandType: newAgentCommand.commandType,
          enabled: newAgentCommand.enabled,
          deviceId: newAgentCommand.deviceId || null
        })
      });
      setNewAgentCommand((prev) => ({ ...prev, trigger: "", responseTemplate: "" }));
      await loadChatbot();
      return true;
    } catch (err) {
      alert(err.message || "Erro ao criar comando #.");
      return false;
    }
  };

  const saveAgentCommand = async (command) => {
    try {
      await api(`/api/chatbot/agent-commands/${command.id}`, {
        method: "PUT",
        body: JSON.stringify({
          trigger: command.trigger,
          responseTemplate: command.responseTemplate,
          commandType: command.commandType,
          enabled: command.enabled,
          deviceId: command.deviceId || null
        })
      });
      await loadChatbot();
      return true;
    } catch (err) {
      alert(err.message || "Erro ao atualizar comando #.");
      return false;
    }
  };

  const submitCommandForm = async () => {
    const payload = {
      id: editingCommandId,
      trigger: newAgentCommand.trigger.trim(),
      responseTemplate: newAgentCommand.responseTemplate.trim(),
      commandType: newAgentCommand.commandType,
      enabled: newAgentCommand.enabled,
      deviceId: newAgentCommand.deviceId || null
    };

    if (!payload.trigger || !payload.trigger.startsWith("#") || payload.trigger.length <= 1) {
      alert("A frase precisa iniciar com #.");
      return;
    }
    if (!payload.responseTemplate) {
      alert("Resposta obrigatoria.");
      return;
    }

    let success = false;
    if (editingCommandId) {
      success = await saveAgentCommand(payload);
    } else {
      success = await createAgentCommand();
    }
    if (success) closeChatbotModal();
  };

  const deleteAgentCommand = async (id) => {
    if (!confirm("Excluir comando #?")) return;
    try {
      await api(`/api/chatbot/agent-commands/${id}`, { method: "DELETE" });
      await loadChatbot();
    } catch (err) {
      alert(err.message || "Erro ao excluir comando #.");
    }
  };

  const toggleAgentCommandEnabled = async (command) => {
    await saveAgentCommand({ ...command, enabled: !command.enabled });
  };

  const createReply = async () => {
    const trigger = newReply.trigger.trim();
    const response = newReply.response.trim();
    if (!trigger || !response) {
      alert("Gatilho e resposta sao obrigatorios.");
      return false;
    }
    try {
      await api("/api/chatbot/quick-replies", {
        method: "POST",
        body: JSON.stringify({
          trigger,
          response,
          matchType: newReply.matchType,
          enabled: newReply.enabled,
          deviceId: newReply.deviceId || null
        })
      });
      setNewReply((prev) => ({ ...prev, trigger: "", response: "" }));
      await loadChatbot();
      return true;
    } catch (err) {
      alert(err.message || "Erro ao criar resposta rapida.");
      return false;
    }
  };

  const saveReply = async (reply) => {
    try {
      await api(`/api/chatbot/quick-replies/${reply.id}`, {
        method: "PUT",
        body: JSON.stringify({
          trigger: reply.trigger,
          response: reply.response,
          matchType: reply.matchType,
          enabled: reply.enabled,
          deviceId: reply.deviceId || null
        })
      });
      await loadChatbot();
      return true;
    } catch (err) {
      alert(err.message || "Erro ao atualizar resposta rapida.");
      return false;
    }
  };

  const deleteReply = async (id) => {
    if (!confirm("Excluir resposta rapida?")) return;
    try {
      await api(`/api/chatbot/quick-replies/${id}`, { method: "DELETE" });
      await loadChatbot();
    } catch (err) {
      alert(err.message || "Erro ao excluir resposta.");
    }
  };

  const isPresetVariableName = (name) => {
    const normalized = (name || "").trim().toLowerCase();
    return presetVariableNames.has(normalized);
  };

  const confirmPresetOverride = (name) => {
    const label = name ? `{#${name}}` : "esta variavel";
    alert(`Atencao: ${label} e uma variavel do sistema. Nao altere sem necessidade.`);
    if (!confirm("Deseja continuar com a alteracao?")) return false;
    return confirm("Confirmar a alteracao da variavel do sistema?");
  };

  const openPresetVariable = (name) => {
    const normalized = (name || "").trim().toLowerCase();
    if (!normalized) return;
    alert(`Variavel do sistema: {#${normalized}}. Evite alterar.`);
    const existing = variables.find(
      (item) => (item.name || "").toLowerCase() === normalized
    );
    if (existing) {
      openVariableModal(existing);
      return;
    }
    setEditingVariableId(null);
    resetVariableForm({ name: normalized, value: "" });
    setVariableModalOpen(true);
  };

  const resetVariableForm = (overrides = {}) => {
    setNewVariable({
      name: "",
      value: "",
      deviceId: variablesDeviceId || "",
      ...overrides
    });
  };

  const openVariableModal = (variable = null) => {
    if (variable) {
      setEditingVariableId(variable.id);
      resetVariableForm({
        name: variable.name || "",
        value: variable.value || "",
        deviceId: variable.deviceId || ""
      });
    } else {
      setEditingVariableId(null);
      resetVariableForm();
    }
    setVariableModalOpen(true);
  };

  const closeVariableModal = () => {
    setVariableModalOpen(false);
    setEditingVariableId(null);
  };

  const createVariable = async () => {
    const name = newVariable.name.trim().toLowerCase();
    const value = newVariable.value.trim();
    if (!name) {
      alert("Nome da variavel obrigatorio.");
      return false;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      alert("Use apenas letras, numeros e _ no nome.");
      return false;
    }
    if (!value) {
      alert("Valor da variavel obrigatorio.");
      return false;
    }
    try {
      await api("/api/chatbot/variables", {
        method: "POST",
        body: JSON.stringify({
          name,
          value,
          deviceId: newVariable.deviceId || null
        })
      });
      resetVariableForm({ name: "", value: "" });
      await loadVariables();
      return true;
    } catch (err) {
      alert(err.message || "Erro ao criar variavel.");
      return false;
    }
  };

  const saveVariable = async (variable) => {
    try {
      await api(`/api/chatbot/variables/${variable.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: variable.name,
          value: variable.value,
          deviceId: variable.deviceId || null
        })
      });
      await loadVariables();
      return true;
    } catch (err) {
      alert(err.message || "Erro ao atualizar variavel.");
      return false;
    }
  };

  const submitVariableForm = async () => {
    const payload = {
      id: editingVariableId,
      name: newVariable.name.trim(),
      value: newVariable.value.trim(),
      deviceId: newVariable.deviceId || null
    };

    if (!payload.name) {
      alert("Nome da variavel obrigatorio.");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(payload.name)) {
      alert("Use apenas letras, numeros e _ no nome.");
      return;
    }
    if (!payload.value) {
      alert("Valor da variavel obrigatorio.");
      return;
    }
    payload.name = payload.name.toLowerCase();
    if (isPresetVariableName(payload.name)) {
      const ok = confirmPresetOverride(payload.name);
      if (!ok) return;
    }

    let success = false;
    if (editingVariableId) {
      success = await saveVariable(payload);
    } else {
      success = await createVariable();
    }
    if (success) closeVariableModal();
  };

  const deleteVariable = async (id) => {
    if (!confirm("Excluir variavel?")) return;
    try {
      await api(`/api/chatbot/variables/${id}`, { method: "DELETE" });
      await loadVariables();
    } catch (err) {
      alert(err.message || "Erro ao excluir variavel.");
    }
  };

  const createFlow = async () => {
    const name = newFlow.name.trim();
    if (!name) {
      alert("Nome do fluxo obrigatorio.");
      return false;
    }
    try {
      const triggers = parseJsonArray(newFlow.triggers);
      const stages = parseJsonArray(newFlow.stages);
      await api("/api/chatbot/flows", {
        method: "POST",
        body: JSON.stringify({
          name,
          triggers,
          stages,
          flowType: newFlow.flowType,
          enabled: newFlow.enabled,
          deviceId: newFlow.deviceId || null
        })
      });
      setNewFlow((prev) => ({ ...prev, name: "", triggers: "[]", stages: "[]" }));
      await loadChatbot();
      return true;
    } catch (err) {
      alert(err.message || "Erro ao criar fluxo.");
      return false;
    }
  };

  const saveFlow = async () => {
    if (!selectedFlow) return;
    try {
      const triggers = parseJsonArray(flowDraft.triggers);
      const stages = parseJsonArray(flowDraft.stages);
      await api(`/api/chatbot/flows/${selectedFlow.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: flowDraft.name,
          triggers,
          stages,
          flowType: flowDraft.flowType,
          enabled: flowDraft.enabled,
          deviceId: flowDraft.deviceId || null
        })
      });
      setFlowError("");
      await loadChatbot();
      return true;
    } catch (err) {
      setFlowError(err.message || "Erro ao salvar fluxo.");
      return false;
    }
  };

  const deleteFlow = async (id) => {
    if (!confirm("Excluir fluxo?")) return;
    try {
      await api(`/api/chatbot/flows/${id}`, { method: "DELETE" });
      await loadChatbot();
    } catch (err) {
      alert(err.message || "Erro ao excluir fluxo.");
    }
  };

  const openConversation = (id) => {
    setActiveConversationId(id);
  };

  const sendConversationMessage = async () => {
    if (!conversationDetails) return;
    const message = conversationMessage.trim();
    if (!message) return;
    const deviceId = conversationDeviceId || conversationDetails.deviceId || "";
    if (!deviceId) {
      alert("Device nao definido.");
      return;
    }
    try {
      await api(`/api/conversations/${conversationDetails.id}/send`, {
        method: "POST",
        body: JSON.stringify({ message, deviceId })
      });
      setConversationMessage("");
      await loadConversationDetails(conversationDetails.id);
      await loadConversations();
    } catch (err) {
      alert(err.message || "Erro ao enviar mensagem.");
    }
  };

  const closeConversation = async () => {
    if (!conversationDetails) return;
    if (!confirm("Finalizar esta conversa?")) return;
    try {
      await api(`/api/conversations/${conversationDetails.id}/close`, { method: "POST" });
      await loadConversationDetails(conversationDetails.id);
      await loadConversations();
    } catch (err) {
      alert(err.message || "Erro ao fechar conversa.");
    }
  };

  const openTestModal = (test) => {
    setDetailModal({
      open: true,
      title: `Teste #${test.id}`,
      content: (
        <div>
          <div className="device-meta">{formatDate(test.createdAt)}</div>
          <div className="device-meta">Device: {test.deviceId || "-"}</div>
          <h4>Payload</h4>
          <pre>{JSON.stringify(test.payload || {}, null, 2)}</pre>
          <h4>Resposta</h4>
          <pre>{JSON.stringify(test.response || {}, null, 2)}</pre>
          {test.errorText ? <div className="hint">Erro: {test.errorText}</div> : null}
        </div>
      )
    });
  };

  const updateFollowupDevice = async (id, deviceId) => {
    try {
      await api(`/api/followups/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ deviceId: deviceId || null })
      });
      await loadFollowups();
    } catch (err) {
      alert(err.message || "Erro ao atualizar follow-up.");
    }
  };

  const filteredDevices = devices.filter((device) => {
    const text = `${device.name || ""} ${device.status || ""} ${device.devicePhone || ""}`
      .toLowerCase()
      .trim();
    const term = deviceFilter.trim().toLowerCase();
    return !term || text.includes(term);
  });

  const qrExpired = qrRemaining <= 0;
  const isEditingChatbot = Boolean(editingCommandId || editingReplyId);
  const isChatbotTypeSelection = !isEditingChatbot && chatbotModalMode === "select";
  const chatbotModalTitle = isEditingChatbot
    ? editingCommandId
      ? "Editar comando #"
      : "Editar resposta rapida"
    : "";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">+TVBOT</div>
          <div>
            <h1>+TVBOT</h1>
            <p>WhatsApp + Chatbot</p>
          </div>
        </div>
        <div className="nav">
          {VIEWS.map((view) => (
            <button
              key={view.id}
              className={`nav-btn ${activeView === view.id ? "active" : ""}`}
              onClick={() => setActiveView(view.id)}
            >
              {view.title}
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="status-pill">WS: {wsStatus}</div>
          <button className="ghost" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </aside>

      <main className="content">
        <div className="topbar">
          <div>
            <h2>{viewMeta.title}</h2>
            <p>{viewMeta.subtitle}</p>
          </div>
          <div className="user-chip">{auth.user?.username || "admin"}</div>
        </div>

        <section className={`view ${activeView === "dashboard" ? "active" : ""}`}>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div>
                <div className="kpi-label">Dispositivos</div>
                <div className="kpi-value">{dashboardStats.totalDevices}</div>
              </div>
              <div className="kpi-icon">D</div>
            </div>
            <div className="kpi-card">
              <div>
                <div className="kpi-label">Total de mensagens</div>
                <div className="kpi-value">{dashboardStats.totalMessages}</div>
              </div>
              <div className="kpi-icon">M</div>
            </div>
            <div className="kpi-card">
              <div>
                <div className="kpi-label">Agendamentos pendentes</div>
                <div className="kpi-value">{dashboardStats.pendingSchedules}</div>
              </div>
              <div className="kpi-icon">A</div>
            </div>
            <div className="kpi-card">
              <div>
                <div className="kpi-label">Contatos</div>
                <div className="kpi-value">{dashboardStats.contacts}</div>
              </div>
              <div className="kpi-icon">C</div>
            </div>
          </div>

          <div className="chart-grid">
            <div className="chart-card">
              <div className="chart-head">
                <h3>Transacoes de Mensagens</h3>
                <select
                  className="select chart-filter"
                  value={dashboardRange}
                  onChange={(event) => setDashboardRange(event.target.value)}
                >
                  {DASHBOARD_RANGES.map((range) => (
                    <option key={range.value} value={range.value}>
                      {range.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="chart-body">
                <svg className="chart-svg" viewBox="0 0 320 140" role="img" aria-label="Transacoes">
                  <polyline points={linePoints} fill="none" stroke="url(#lineGradient)" strokeWidth="3" />
                  <defs>
                    <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#22c55e" />
                      <stop offset="100%" stopColor="#8b5cf6" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="chart-axis">
                  {messageSeries.labels.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="chart-card">
              <div className="chart-head">
                <h3>Respostas Automaticas</h3>
                <select
                  className="select chart-filter"
                  value={dashboardRange}
                  onChange={(event) => setDashboardRange(event.target.value)}
                >
                  {DASHBOARD_RANGES.map((range) => (
                    <option key={range.value} value={range.value}>
                      {range.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="chart-body">
                <div className="bar-chart">
                  {autoReplySeries.values.map((value, index) => (
                    <div key={`${value}-${index}`} className="bar">
                      <span style={{ height: `${Math.round((value / barMax) * 100)}%` }} />
                    </div>
                  ))}
                </div>
                <div className="chart-axis">
                  {autoReplySeries.labels.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="chart-grid">
            <div className="chart-card">
              <div className="chart-head">
                <h3>Mensagens</h3>
                <select
                  className="select chart-filter"
                  value={dashboardRange}
                  onChange={(event) => setDashboardRange(event.target.value)}
                >
                  {DASHBOARD_RANGES.map((range) => (
                    <option key={range.value} value={range.value}>
                      {range.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="donut-wrap">
                <div className="donut-chart" style={{ background: donutGradient }}>
                  <div className="donut-center">
                    <div className="donut-value">{donutTotal}</div>
                    <div className="donut-label">mensagens</div>
                  </div>
                </div>
                <div className="donut-legend">
                  {donutData.map((item) => {
                    const pct = donutTotal ? Math.round((item.value / donutTotal) * 100) : 0;
                    return (
                      <div key={item.label} className="legend-item">
                        <span className="legend-dot" style={{ background: item.color }} />
                        <span>{item.label}</span>
                        <span className="legend-pct">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="chart-card">
              <div className="chart-head">
                <h3>Estatisticas de Dispositivos</h3>
              </div>
              <div className="device-stats">
                {deviceStats.length === 0 ? (
                  <div className="empty-state">Nenhum dispositivo cadastrado.</div>
                ) : (
                  deviceStats.map((device) => (
                    <div key={device.id} className="device-stat">
                      <div>
                        <div className="device-title">
                          {device.name || device.id} {device.devicePhone ? `(${device.devicePhone})` : ""}
                        </div>
                        <div className="device-sub">
                          <span className={`dot ${device.status === "connected" ? "on" : "off"}`} />
                          {device.status === "connected" ? "Online" : "Offline"}
                        </div>
                      </div>
                      <div className="device-metric">{device.messageCount} mensagens</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <section className={`view ${activeView === "devices" ? "active" : ""}`}>
          <div className="card">
            <div className="card-head">
              <h3>Dispositivos</h3>
              <span className="badge">Sessao por QR sob demanda</span>
            </div>
            <div className="form-row">
              <input
                className="input"
                placeholder="Nome do dispositivo"
                value={newDeviceName}
                onChange={(event) => setNewDeviceName(event.target.value)}
              />
              <button className="primary" onClick={createDevice}>
                Criar
              </button>
              <input
                className="input"
                placeholder="Filtrar por nome, status ou telefone"
                value={deviceFilter}
                onChange={(event) => setDeviceFilter(event.target.value)}
              />
            </div>
          </div>
          <div className="card">
            <div className="device-grid">
              {filteredDevices.length === 0 ? (
                <div className="device-card">Nenhum dispositivo encontrado.</div>
              ) : (
                filteredDevices.map((device) => (
                  <div className="device-card" key={device.id}>
                    <div className="title">{device.name || device.id}</div>
                    <div className={`status ${formatStatus(device.status)}`}>
                      {formatStatus(device.status).replace("_", " ")}
                    </div>
                    <div className="device-meta">
                      <div>Telefone: {device.devicePhone || "-"}</div>
                      <div>Ultima atividade: {formatDate(device.lastActivity)}</div>
                      {device.lastError ? <div>Erro: {device.lastError}</div> : null}
                    </div>
                    <div className="form-row">
                      <button className="secondary" onClick={() => openQrModal(device)}>
                        QR
                      </button>
                      <button className="secondary" onClick={() => reconnectDevice(device.id)}>
                        Reconectar
                      </button>
                      <button className="danger" onClick={() => deleteDevice(device.id)}>
                        Remover
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={`view ${activeView === "chatbot" ? "active" : ""}`}>
          <div className="chatbot-header">
            <div>
              <h3>Respostas Automaticas</h3>
              <div className="device-meta">Configure comandos # e respostas rapidas por dispositivo.</div>
            </div>
            <div className="chatbot-actions">
              <button className="secondary" onClick={() => loadChatbot().catch(() => {})}>
                Atualizar
              </button>
              <button className="primary" onClick={openChatbotModal}>
                Criar comando/resposta
              </button>
            </div>
          </div>

          <div className="summary-grid">
            <div className="summary-card">
              <div>
                <div className="summary-label">Comandos #</div>
                <div className="summary-value">{commandStats.total}</div>
              </div>
              <div className="summary-icon">#</div>
            </div>
            <div className="summary-card">
              <div>
                <div className="summary-label">Comandos teste</div>
                <div className="summary-value">{commandStats.tests}</div>
              </div>
              <div className="summary-icon">T</div>
            </div>
            <div className="summary-card">
              <div>
                <div className="summary-label">Respostas rapidas</div>
                <div className="summary-value">{replyStats.total}</div>
              </div>
              <div className="summary-icon">R</div>
            </div>
            <div className="summary-card">
              <div>
                <div className="summary-label">Respostas ativas</div>
                <div className="summary-value">{replyStats.active}</div>
              </div>
              <div className="summary-icon">A</div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Comandos #</h3>
              <span className="badge">{agentCommands.length}</span>
            </div>
            <div className="command-list">
              {agentCommands.length === 0 ? (
                <div className="empty-state">Nenhum comando # cadastrado.</div>
              ) : (
                agentCommands.map((command) => {
                  const preview =
                    command.responseTemplate && command.responseTemplate.length > 120
                      ? `${command.responseTemplate.slice(0, 117)}...`
                      : command.responseTemplate || "-";
                  const deviceLabel = command.deviceId
                    ? deviceLabelMap.get(command.deviceId) || command.deviceId
                    : "Todos";
                  const isExpanded = expandedCommandId === command.id;
                  const typeLabel = command.commandType === "test" ? "Teste NewBR" : "Resposta normal";
                  return (
                    <div key={command.id} className={`reply-item ${isExpanded ? "expanded" : ""}`}>
                      <div className="reply-main">
                        <div className="reply-left">
                          <div className="reply-icon">#</div>
                          <div>
                            <div className="reply-label">{typeLabel}</div>
                            <div className="reply-title">{command.trigger || "-"}</div>
                            <div className="reply-meta">{preview}</div>
                          </div>
                        </div>
                        <div className="reply-actions">
                          <span className={`pill ${command.enabled ? "success" : "danger"}`}>
                            {command.enabled ? "Ativo" : "Inativo"}
                          </span>
                          <button
                            className="icon"
                            onClick={() =>
                              setExpandedCommandId(isExpanded ? null : command.id)
                            }
                          >
                            {isExpanded ? "Fechar" : "Abrir"}
                          </button>
                        </div>
                      </div>
                      {isExpanded ? (
                        <div className="reply-expanded">
                          <div className="reply-detail">
                            <div className="reply-detail-title">Resposta</div>
                            <div className="reply-detail-text">{command.responseTemplate || "-"}</div>
                          </div>
                          <div className="reply-detail-row">
                            <span>Device:</span> {deviceLabel}
                          </div>
                          <div className="reply-detail-row">
                            <span>Tipo:</span> {typeLabel}
                          </div>
                          <div className="form-row">
                            <button className="secondary" onClick={() => openCommandModal(command)}>
                              Editar
                            </button>
                            <button className="secondary" onClick={() => toggleAgentCommandEnabled(command)}>
                              {command.enabled ? "Desativar" : "Ativar"}
                            </button>
                            <button className="danger" onClick={() => deleteAgentCommand(command.id)}>
                              Excluir
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="card">
            <div className="filter-bar">
              <input
                className="input"
                placeholder="Buscar"
                value={chatbotQuery}
                onChange={(event) => setChatbotQuery(event.target.value)}
              />
              <select
                className="select"
                value={chatbotSearchMode}
                onChange={(event) => setChatbotSearchMode(event.target.value)}
              >
                <option value="trigger">Palavra-chave</option>
                <option value="response">Resposta</option>
              </select>
              <select
                className="select"
                value={chatbotDeviceId}
                onChange={(event) => setChatbotDeviceId(event.target.value)}
              >
                <option value="">Todos os Dispositivos</option>
                {deviceOptions.map((device) => (
                  <option key={device.value} value={device.value}>
                    {device.label}
                  </option>
                ))}
              </select>
              <select
                className="select"
                value={chatbotMatchFilter}
                onChange={(event) => setChatbotMatchFilter(event.target.value)}
              >
                <option value="">Todas Palavras-chave</option>
                <option value="exact">Frase Exata</option>
                <option value="list">Lista</option>
                <option value="includes">Contem</option>
                <option value="starts_with">Comeca</option>
              </select>
              <button className="primary" onClick={() => setReplyPage(1)}>
                Buscar
              </button>
              <button className="ghost" onClick={clearReplyFilters}>
                Limpar tudo
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Respostas rapidas</h3>
              <span className="badge">{filteredReplies.length}</span>
            </div>
            <div className="reply-list">
              {pagedReplies.length === 0 ? (
                <div className="empty-state">Nenhuma resposta encontrada.</div>
              ) : (
                pagedReplies.map((reply) => {
                  const preview =
                    reply.response && reply.response.length > 120
                      ? `${reply.response.slice(0, 117)}...`
                      : reply.response || "-";
                  const deviceLabel = reply.deviceId
                    ? deviceLabelMap.get(reply.deviceId) || reply.deviceId
                    : "Todos";
                  const isExpanded = expandedReplyId === reply.id;
                  return (
                    <div key={reply.id} className={`reply-item ${isExpanded ? "expanded" : ""}`}>
                      <div className="reply-main">
                        <div className="reply-left">
                          <div className="reply-icon">RB</div>
                          <div>
                            <div className="reply-label">{getMatchLabel(reply.matchType)}</div>
                            <div className="reply-title">{reply.trigger || "-"}</div>
                            <div className="reply-meta">{preview}</div>
                          </div>
                        </div>
                        <div className="reply-actions">
                          <span className={`pill ${reply.enabled ? "success" : "danger"}`}>
                            {reply.enabled ? "Ativa" : "Inativa"}
                          </span>
                          <button
                            className="icon"
                            onClick={() => setExpandedReplyId(isExpanded ? null : reply.id)}
                          >
                            {isExpanded ? "Fechar" : "Abrir"}
                          </button>
                        </div>
                      </div>
                      {isExpanded ? (
                        <div className="reply-expanded">
                          <div className="reply-detail">
                            <div className="reply-detail-title">Resposta</div>
                            <div className="reply-detail-text">{reply.response || "-"}</div>
                          </div>
                          <div className="reply-detail-row">
                            <span>Device:</span> {deviceLabel}
                          </div>
                          <div className="reply-detail-row">
                            <span>Tipo:</span> {getMatchLabel(reply.matchType)}
                          </div>
                          <div className="form-row">
                            <button className="secondary" onClick={() => openReplyModal(reply)}>
                              Editar
                            </button>
                            <button className="secondary" onClick={() => toggleReplyEnabled(reply)}>
                              {reply.enabled ? "Desativar" : "Ativar"}
                            </button>
                            <button className="danger" onClick={() => deleteReply(reply.id)}>
                              Excluir
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
            {replyPageCount > 1 ? (
              <div className="pagination">
                {Array.from({ length: replyPageCount }, (_, index) => index + 1).map((page) => (
                  <button
                    key={`reply-page-${page}`}
                    className={`page-btn ${page === replyPage ? "active" : ""}`}
                    onClick={() => setReplyPage(page)}
                  >
                    {page}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

        </section>

        <section className={`view ${activeView === "variables" ? "active" : ""}`}>
          <div className="chatbot-header">
            <div>
              <h3>Variaveis</h3>
              <div className="device-meta">Use {`{#nome_da_variavel}`} nas respostas e comandos.</div>
            </div>
            <div className="chatbot-actions">
              <button className="secondary" onClick={() => loadVariables().catch(() => {})}>
                Atualizar
              </button>
              <button className="primary" onClick={() => openVariableModal()}>
                Criar variavel
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Variaveis pre-criadas</h3>
              <span className="badge">Sistema</span>
            </div>
            <div className="list">
              {PRESET_VARIABLES.map((item) => {
                const token = `{#${item.name}}`;
                return (
                  <div key={item.name} className="list-item">
                    <div className="title">{token}</div>
                    <div className="meta">{item.label}</div>
                    <div className="mini-note">Puxa: {item.source}</div>
                    <div className="form-row">
                      <button className="secondary" onClick={() => openPresetVariable(item.name)}>
                        Sobrescrever
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hint">
              Nao altere essas variaveis do sistema sem necessidade. A alteracao pede confirmacao extra.
            </div>
          </div>

          <div className="card">
            <div className="filter-bar">
              <input
                className="input"
                placeholder="Buscar variavel ou valor"
                value={variablesQuery}
                onChange={(event) => setVariablesQuery(event.target.value)}
              />
              <select
                className="select"
                value={variablesDeviceId}
                onChange={(event) => setVariablesDeviceId(event.target.value)}
              >
                <option value="">Todos os Dispositivos</option>
                {deviceOptions.map((device) => (
                  <option key={device.value} value={device.value}>
                    {device.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="card">
            <div className="reply-list">
              {filteredVariables.length === 0 ? (
                <div className="empty-state">Nenhuma variavel cadastrada.</div>
              ) : (
                filteredVariables.map((variable) => {
                  const preview =
                    variable.value && variable.value.length > 120
                      ? `${variable.value.slice(0, 117)}...`
                      : variable.value || "-";
                  const deviceLabel = variable.deviceId
                    ? deviceLabelMap.get(variable.deviceId) || variable.deviceId
                    : "Todos";
                  const isExpanded = expandedVariableId === variable.id;
                  const tokenLabel = variable.name ? `{#${variable.name}}` : "-";
                  return (
                    <div key={variable.id} className={`reply-item ${isExpanded ? "expanded" : ""}`}>
                      <div className="reply-main">
                        <div className="reply-left">
                          <div className="reply-icon">VAR</div>
                          <div>
                            <div className="reply-label">Variavel</div>
                            <div className="reply-title">{tokenLabel}</div>
                            <div className="reply-meta">{preview}</div>
                          </div>
                        </div>
                        <div className="reply-actions">
                          <button
                            className="icon"
                            onClick={() => setExpandedVariableId(isExpanded ? null : variable.id)}
                          >
                            {isExpanded ? "Fechar" : "Abrir"}
                          </button>
                        </div>
                      </div>
                      {isExpanded ? (
                        <div className="reply-expanded">
                          <div className="reply-detail">
                            <div className="reply-detail-title">Valor</div>
                            <div className="reply-detail-text">{variable.value || "-"}</div>
                          </div>
                          <div className="reply-detail-row">
                            <span>Token:</span> {tokenLabel}
                          </div>
                          <div className="reply-detail-row">
                            <span>Device:</span> {deviceLabel}
                          </div>
                          <div className="form-row">
                            <button className="secondary" onClick={() => openVariableModal(variable)}>
                              Editar
                            </button>
                            <button className="danger" onClick={() => deleteVariable(variable.id)}>
                              Excluir
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className={`view ${activeView === "flows" ? "active" : ""}`}>
          <div className="card">
            <div className="card-head">
              <h3>Flows (em breve)</h3>
            </div>
            <div className="empty-state">
              Aguardando o modelo para montar a nova aba de flows.
            </div>
          </div>
        </section>

        <section className={`view ${activeView === "conversations" ? "active" : ""}`}>
          <div className="card">
            <div className="card-head">
              <h3>Conversas</h3>
              <span className="badge">Somente contatos</span>
            </div>
            <div className="form-row">
              <input
                className="input"
                placeholder="Buscar por nome, telefone ou protocolo"
                value={conversationFilters.q}
                onChange={(event) =>
                  setConversationFilters((prev) => ({ ...prev, q: event.target.value }))
                }
              />
              <select
                className="select"
                value={conversationFilters.status}
                onChange={(event) =>
                  setConversationFilters((prev) => ({ ...prev, status: event.target.value }))
                }
              >
                <option value="">Todos</option>
                <option value="open">Abertas</option>
                <option value="closed">Fechadas</option>
              </select>
              <select
                className="select"
                value={conversationFilters.deviceId}
                onChange={(event) =>
                  setConversationFilters((prev) => ({ ...prev, deviceId: event.target.value }))
                }
              >
                <option value="">Todos</option>
                {deviceOptions.map((device) => (
                  <option key={device.value} value={device.value}>
                    {device.label}
                  </option>
                ))}
              </select>
              <button className="secondary" onClick={() => loadConversations().catch(() => {})}>
                Atualizar
              </button>
            </div>
          </div>
          <div className="card">
            <div className="conversation-layout">
              <div>
                <div className="conversation-list">
                  {conversations.length === 0 ? (
                    <div className="list-item">Nenhuma conversa encontrada.</div>
                  ) : (
                    conversations.map((convo) => (
                      <div
                        key={convo.id}
                        className="list-item"
                        onClick={() => openConversation(convo.id)}
                      >
                        <div className="title">
                          {convo.name || "Sem nome"} ({convo.phone || "-"})
                        </div>
                        <div className="meta">
                          {convo.protocol || "-"} | {convo.deviceName || "Sem device"} |{" "}
                          {formatDate(convo.lastMessageAt || convo.startedAt)}
                        </div>
                        <div className="meta">{convo.lastMessage || "-"}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="conversation-detail">
                {!conversationDetails ? (
                  <div className="device-meta">Selecione uma conversa para ver detalhes.</div>
                ) : (
                  <>
                    <div className="card-head">
                      <div>
                        <h3>{conversationDetails.name || "Sem nome"}</h3>
                        <div className="device-meta">
                          {conversationDetails.phone || "-"} | {conversationDetails.deviceName || "Sem device"}
                          {conversationDetails.devicePhone ? ` (${conversationDetails.devicePhone})` : ""}
                        </div>
                        <div className="device-meta">Status: {conversationDetails.status}</div>
                      </div>
                      <div className="conversation-actions">
                        <button
                          className="secondary"
                          onClick={() => loadConversationDetails(conversationDetails.id)}
                        >
                          Atualizar
                        </button>
                        <button className="danger" onClick={closeConversation}>
                          Fechar conversa
                        </button>
                      </div>
                    </div>

                    <div className="conversation-messages">
                      {(conversationDetails.messages || []).length === 0 ? (
                        <div className="device-meta">Sem mensagens registradas.</div>
                      ) : (
                        conversationDetails.messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`message ${msg.direction === "out" ? "out" : "in"}`}
                          >
                            <div className="meta">
                              {msg.origin || "-"} | {msg.messageType || "text"} |{" "}
                              {formatDate(msg.createdAt)}
                            </div>
                            <div className="text">{msg.content}</div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="flow-timeline">
                      {(conversationDetails.flowEvents || []).length === 0 ? (
                        <div className="device-meta">Sem eventos de fluxo.</div>
                      ) : (
                        conversationDetails.flowEvents.map((event) => (
                          <div key={event.id} className="flow-step">
                            <div className="meta">
                              {formatDate(event.createdAt)} | {event.eventType}
                            </div>
                            <div>
                              Flow: {event.flow || "-"} | Etapa: {event.stage || "-"}
                            </div>
                            {event.content ? <div className="device-meta">{event.content}</div> : null}
                          </div>
                        ))
                      )}
                    </div>

                    <div className="conversation-send">
                      <textarea
                        className="textarea"
                        placeholder="Escreva uma mensagem..."
                        value={conversationMessage}
                        onChange={(event) => setConversationMessage(event.target.value)}
                      />
                      <div className="form-row">
                        <select
                          className="select"
                          value={conversationDeviceId}
                          onChange={(event) => setConversationDeviceId(event.target.value)}
                        >
                          <option value="">Selecionar device</option>
                          {deviceOptions.map((device) => (
                            <option key={device.value} value={device.value}>
                              {device.label}
                            </option>
                          ))}
                        </select>
                        <button className="primary" onClick={sendConversationMessage}>
                          Enviar
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className={`view ${activeView === "tests" ? "active" : ""}`}>
          <div className="card">
            <div className="card-head">
              <h3>Testes API</h3>
            </div>
            <div className="form-row">
              <select
                className="select"
                value={testsFilters.status}
                onChange={(event) => setTestsFilters((prev) => ({ ...prev, status: event.target.value }))}
              >
                <option value="">Todos</option>
                <option value="success">Sucesso</option>
                <option value="error">Erro</option>
              </select>
              <input
                className="input"
                type="datetime-local"
                value={testsFilters.from}
                onChange={(event) => setTestsFilters((prev) => ({ ...prev, from: event.target.value }))}
              />
              <input
                className="input"
                type="datetime-local"
                value={testsFilters.to}
                onChange={(event) => setTestsFilters((prev) => ({ ...prev, to: event.target.value }))}
              />
              <select
                className="select"
                value={testsFilters.deviceId}
                onChange={(event) => setTestsFilters((prev) => ({ ...prev, deviceId: event.target.value }))}
              >
                <option value="">Todos</option>
                {deviceOptions.map((device) => (
                  <option key={device.value} value={device.value}>
                    {device.label}
                  </option>
                ))}
              </select>
              <button className="secondary" onClick={() => loadTests().catch(() => {})}>
                Atualizar
              </button>
            </div>
          </div>
          <div className="card">
            <div className="list">
              {tests.length === 0 ? (
                <div className="list-item">Nenhum teste registrado.</div>
              ) : (
                tests.map((test) => (
                  <div key={test.id} className="list-item" onClick={() => openTestModal(test)}>
                    <div className="title">
                      #{test.id} {test.flow || "-"} ({test.status || "-"})
                    </div>
                    <div className="meta">
                      {formatDate(test.createdAt)} | {test.deviceId || "sem device"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={`view ${activeView === "followups" ? "active" : ""}`}>
          <div className="card">
            <div className="card-head">
              <h3>Follow-ups</h3>
              <span className="badge">Reassign device</span>
            </div>
            <div className="list">
              {followups.length === 0 ? (
                <div className="list-item">Nenhum follow-up pendente.</div>
              ) : (
                followups.map((rec) => (
                  <div key={rec.id} className="list-item">
                    <div className="title">
                      {rec.clientName || "Sem nome"} ({rec.clientPhone || "-"})
                    </div>
                    <div className="meta">
                      Criado: {formatDate(rec.createdAt)} | Sessao: {rec.sessionName || "-"}
                    </div>
                    <div className="meta">Chat: {rec.chatId || "-"}</div>
                    <div className="form-row">
                      <select
                        className="select"
                        value={rec.deviceId || ""}
                        onChange={(event) => updateFollowupDevice(rec.id, event.target.value)}
                      >
                        <option value="">Automatico</option>
                        {deviceOptions.map((device) => (
                          <option key={device.value} value={device.value}>
                            {device.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>

      {flowEditorOpen && selectedFlow ? (
        <div className="flow-editor-overlay">
          <div className="flow-editor-shell">
            <div className="flow-editor-topbar">
              <div className="flow-editor-left">
                <button className="icon" onClick={closeFlowEditor}>
                  Voltar
                </button>
                <div className="flow-editor-title">
                  <input
                    className="flow-title-input"
                    value={flowDraft.name}
                    onChange={(event) => setFlowDraft((prev) => ({ ...prev, name: event.target.value }))}
                  />
                  <div className="device-meta">
                    {flowDraft.deviceId
                      ? `Device: ${deviceLabelMap.get(flowDraft.deviceId) || flowDraft.deviceId}`
                      : "Global"}
                  </div>
                </div>
              </div>
              <div className="flow-editor-actions">
                <select
                  className="select compact"
                  value={flowDraft.deviceId}
                  onChange={(event) => setFlowDraft((prev) => ({ ...prev, deviceId: event.target.value }))}
                >
                  <option value="">Todos</option>
                  {deviceOptions.map((device) => (
                    <option key={device.value} value={device.value}>
                      {device.label}
                    </option>
                  ))}
                </select>
                <button className="secondary" onClick={() => alert("Simulacao do fluxo em breve.")}>
                  Simular fluxo
                </button>
                <label className="flow-switch">
                  <span>Ativado</span>
                  <input
                    type="checkbox"
                    checked={flowDraft.enabled}
                    onChange={(event) => setFlowDraft((prev) => ({ ...prev, enabled: event.target.checked }))}
                  />
                </label>
                <button className="primary" onClick={saveFlow}>
                  Salvar
                </button>
              </div>
            </div>
            <div className="flow-editor-body">
              <aside className="flow-editor-sidebar">
                <div className="flow-section">
                  <div className="flow-section-head">
                    <span className="flow-dot green" />
                    Acionamentos
                  </div>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.anyMessage}
                      onChange={() => toggleFlowRule("anyMessage")}
                    />
                    <span>Quando qualquer mensagem e recebida.</span>
                  </label>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.keywordMessage}
                      onChange={() => toggleFlowRule("keywordMessage")}
                    />
                    <span>Quando a mensagem contem palavras-chave.</span>
                  </label>
                  <div className="flow-tags">
                    {flowTriggerList.length === 0 ? (
                      <div className="device-meta">Nenhuma palavra-chave configurada.</div>
                    ) : (
                      flowTriggerList.map((trigger) => (
                        <span key={trigger} className="flow-tag">
                          {trigger}
                          <button className="tag-close" onClick={() => removeFlowTrigger(trigger)}>
                            x
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  <div className="flow-tag-input">
                    <input
                      className="input"
                      placeholder="Digite uma palavra chave"
                      value={flowTriggerInput}
                      onChange={(event) => setFlowTriggerInput(event.target.value)}
                      disabled={!flowRuleState.keywordMessage}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addFlowTrigger();
                        }
                      }}
                    />
                    <button className="secondary" onClick={addFlowTrigger} disabled={!flowRuleState.keywordMessage}>
                      Adicionar
                    </button>
                  </div>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.firstMessageDay}
                      onChange={() => toggleFlowRule("firstMessageDay")}
                    />
                    <span>Primeira mensagem do cliente no dia.</span>
                  </label>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.firstMessage}
                      onChange={() => toggleFlowRule("firstMessage")}
                    />
                    <span>Primeira mensagem do cliente.</span>
                  </label>
                </div>

                <div className="flow-section">
                  <div className="flow-section-head">
                    <span className="flow-dot amber" />
                    Blocos de acoes (7)
                  </div>
                  <div className="flow-action-grid">
                    <div className="flow-action-card">Enviar Texto</div>
                    <div className="flow-action-card">Enviar Imagem</div>
                    <div className="flow-action-card">Enviar Video</div>
                    <div className="flow-action-card">Enviar Audio</div>
                    <div className="flow-action-card">Enviar Documento</div>
                    <div className="flow-action-card">Respostas</div>
                    <div className="flow-action-card">Enviar Lista</div>
                  </div>
                </div>

                <div className="flow-section">
                  <div className="flow-section-head">
                    <span className="flow-dot purple" />
                    Regras
                  </div>
                  <div className="flow-subhead">Regras gerais:</div>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.allowGroups}
                      onChange={() => toggleFlowRule("allowGroups")}
                    />
                    <span>Permitir responder a grupos.</span>
                  </label>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.scheduleOnly}
                      onChange={() => toggleFlowRule("scheduleOnly")}
                    />
                    <span>Permitir respostas apenas em dias e horarios definidos.</span>
                  </label>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.ignoreOpen}
                      onChange={() => toggleFlowRule("ignoreOpen")}
                    />
                    <span>Nao responder se a conversa estiver aberta.</span>
                  </label>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.customSignature}
                      onChange={() => toggleFlowRule("customSignature")}
                    />
                    <span>Personalizar ou desativar assinatura.</span>
                  </label>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.simulateTyping}
                      onChange={() => toggleFlowRule("simulateTyping")}
                    />
                    <span>Simular que esta digitando ou gravando audio.</span>
                  </label>

                  <div className="flow-subhead">Regras de CRM:</div>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.crmIgnore}
                      onChange={() => toggleFlowRule("crmIgnore")}
                    />
                    <span>Nao responder se o contato estiver em um CRM.</span>
                  </label>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.crmIgnoreAll}
                      onChange={() => toggleFlowRule("crmIgnoreAll")}
                    />
                    <span>Nao responder os CRMs.</span>
                  </label>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.crmOnly}
                      onChange={() => toggleFlowRule("crmOnly")}
                    />
                    <span>Responder apenas os CRMs.</span>
                  </label>

                  <div className="flow-subhead">Regras de etiqueta:</div>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.tagIgnore}
                      onChange={() => toggleFlowRule("tagIgnore")}
                    />
                    <span>Nao responder se o contato estiver etiquetado.</span>
                  </label>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.tagIgnoreAll}
                      onChange={() => toggleFlowRule("tagIgnoreAll")}
                    />
                    <span>Nao responder as etiquetas.</span>
                  </label>
                  <label className="flow-toggle">
                    <input
                      type="checkbox"
                      checked={flowRuleState.tagOnly}
                      onChange={() => toggleFlowRule("tagOnly")}
                    />
                    <span>Responder apenas as etiquetas.</span>
                  </label>
                </div>

                <div className="flow-section">
                  <button className="ghost" onClick={() => setFlowJsonOpen((prev) => !prev)}>
                    {flowJsonOpen ? "Ocultar JSON" : "Editor JSON"}
                  </button>
                  {flowJsonOpen ? (
                    <div className="flow-json">
                      <div className="flow-json-label">Etapas (JSON)</div>
                      <textarea
                        className="textarea"
                        value={flowDraft.stages}
                        onChange={(event) =>
                          setFlowDraft((prev) => ({ ...prev, stages: event.target.value }))
                        }
                      />
                      {flowStageParsed.error ? <div className="hint">{flowStageParsed.error}</div> : null}
                    </div>
                  ) : null}
                  {flowError ? <div className="hint">{flowError}</div> : null}
                </div>
              </aside>

              <div className="flow-editor-canvas">
                <ReactFlow nodes={flowEditorGraph.nodes} edges={flowEditorGraph.edges} fitView>
                  <Background variant="dots" gap={24} size={1} color="rgba(148, 163, 184, 0.2)" />
                  <Controls />
                  <MiniMap />
                </ReactFlow>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {chatbotModalOpen ? (
        <div
          className="modal"
          onClick={(event) => {
            if (event.target.classList.contains("modal")) closeChatbotModal();
          }}
        >
          <div className="modal-card wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              {isEditingChatbot ? (
                <h3>{chatbotModalTitle}</h3>
              ) : (
                <div className="modal-tabs">
                  <button
                    className={`modal-tab ${chatbotModalMode === "command" ? "active" : ""}`}
                    onClick={() => setChatbotModalMode("command")}
                  >
                    Comando #
                  </button>
                  <button
                    className={`modal-tab ${chatbotModalMode === "reply" ? "active" : ""}`}
                    onClick={() => setChatbotModalMode("reply")}
                  >
                    Resposta rapida
                  </button>
                </div>
              )}
              <button className="icon" onClick={closeChatbotModal}>
                X
              </button>
            </div>
            <div className="modal-body chatbot-modal">
              <div className="chatbot-form">
                {isChatbotTypeSelection ? (
                  <div className="empty-state">Selecione o tipo para continuar.</div>
                ) : chatbotModalMode === "command" ? (
                  <>
                    <div className="form-row">
                      <select
                        className="select"
                        value={newAgentCommand.deviceId}
                        onChange={(event) =>
                          setNewAgentCommand((prev) => ({ ...prev, deviceId: event.target.value }))
                        }
                      >
                        <option value="">Todos os Dispositivos</option>
                        {deviceOptions.map((device) => (
                          <option key={device.value} value={device.value}>
                            {device.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      className="input"
                      placeholder="#frase exata enviada pelo agente"
                      value={newAgentCommand.trigger}
                      onChange={(event) =>
                        setNewAgentCommand((prev) => ({ ...prev, trigger: event.target.value }))
                      }
                    />
                    <div className="command-type">
                      <label className="command-radio">
                        <input
                          type="radio"
                          name="commandType"
                          value="test"
                          checked={newAgentCommand.commandType === "test"}
                          onChange={(event) =>
                            setNewAgentCommand((prev) => ({
                              ...prev,
                              commandType: event.target.value
                            }))
                          }
                        />
                        <span>Gera teste no NewBR</span>
                      </label>
                      <label className="command-radio">
                        <input
                          type="radio"
                          name="commandType"
                          value="reply"
                          checked={newAgentCommand.commandType === "reply"}
                          onChange={(event) =>
                            setNewAgentCommand((prev) => ({
                              ...prev,
                              commandType: event.target.value
                            }))
                          }
                        />
                        <span>Apenas resposta normal</span>
                      </label>
                    </div>
                    <textarea
                      className="textarea"
                      placeholder="Resposta"
                      value={newAgentCommand.responseTemplate}
                      onChange={(event) =>
                        setNewAgentCommand((prev) => ({
                          ...prev,
                          responseTemplate: event.target.value
                        }))
                      }
                    />
                    <label className="flow-switch inline">
                      <span>Ativo</span>
                      <input
                        type="checkbox"
                        checked={newAgentCommand.enabled}
                        onChange={(event) =>
                          setNewAgentCommand((prev) => ({
                            ...prev,
                            enabled: event.target.checked
                          }))
                        }
                      />
                    </label>
                    <div className="form-row">
                      <button className="secondary" onClick={closeChatbotModal}>
                        Cancelar
                      </button>
                      <button className="primary" onClick={submitCommandForm}>
                        {editingCommandId ? "Salvar" : "Criar"}
                      </button>
                    </div>
                  </>
                ) : chatbotModalMode === "reply" ? (
                  <>
                    <div className="form-row">
                      <select
                        className="select"
                        value={newReply.deviceId}
                        onChange={(event) =>
                          setNewReply((prev) => ({ ...prev, deviceId: event.target.value }))
                        }
                      >
                        <option value="">Todos os Dispositivos</option>
                        {deviceOptions.map((device) => (
                          <option key={device.value} value={device.value}>
                            {device.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className="select"
                        value={newReply.matchType}
                        onChange={(event) =>
                          setNewReply((prev) => ({ ...prev, matchType: event.target.value }))
                        }
                      >
                        <option value="exact">Frase Exata</option>
                        <option value="list">Lista</option>
                        <option value="includes">Contem</option>
                        <option value="starts_with">Comeca</option>
                      </select>
                    </div>
                    <input
                      className="input"
                      placeholder="Palavra-chave"
                      value={newReply.trigger}
                      onChange={(event) =>
                        setNewReply((prev) => ({ ...prev, trigger: event.target.value }))
                      }
                    />
                    <textarea
                      className="textarea"
                      placeholder="Resposta"
                      value={newReply.response}
                      onChange={(event) =>
                        setNewReply((prev) => ({ ...prev, response: event.target.value }))
                      }
                    />
                    <label className="flow-switch inline">
                      <span>Ativa</span>
                      <input
                        type="checkbox"
                        checked={newReply.enabled}
                        onChange={(event) =>
                          setNewReply((prev) => ({ ...prev, enabled: event.target.checked }))
                        }
                      />
                    </label>
                    <div className="form-row">
                      <button className="secondary" onClick={closeChatbotModal}>
                        Cancelar
                      </button>
                      <button className="primary" onClick={submitReplyForm}>
                        {editingReplyId ? "Salvar" : "Criar"}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
              <aside className="vars-panel">
                <div className="vars-title">Variaveis disponiveis</div>
                <div className="vars-list">
                  <div>
                    <span className="vars-token">{"{#nome}"}</span> Nome do contato ou WhatsApp
                  </div>
                  <div>
                    <span className="vars-token">{"{#telefone}"}</span> Telefone do contato
                  </div>
                  <div>
                    <span className="vars-token">{"{#usuario}"}</span> Usuario do teste NewBR
                  </div>
                  <div>
                    <span className="vars-token">{"{#senha}"}</span> Senha do teste NewBR
                  </div>
                  <div>
                    <span className="vars-token">{"{#http1}"}</span> Primeiro link HTTP curto
                  </div>
                  <div>
                    <span className="vars-token">{"{#http2}"}</span> Segundo link HTTP curto
                  </div>
                </div>
                <div className="vars-note">
                  Variaveis de teste funcionam apenas quando o comando # esta marcado como NewBR. Links HTTP
                  usam URLs curtas (ex: http://bludx.top).
                </div>
                <div className="vars-title">Modelo de resposta</div>
                <pre className="vars-example">{`LAZER PLAY

Cod: br99
Usuario: {#usuario}
Senha: {#senha}`}</pre>
              </aside>
            </div>
          </div>
        </div>
      ) : null}

      {variableModalOpen ? (
        <div
          className="modal"
          onClick={(event) => {
            if (event.target.classList.contains("modal")) closeVariableModal();
          }}
        >
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{editingVariableId ? "Editar variavel" : "Criar variavel"}</h3>
              <button className="icon" onClick={closeVariableModal}>
                X
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <select
                  className="select"
                  value={newVariable.deviceId}
                  onChange={(event) =>
                    setNewVariable((prev) => ({ ...prev, deviceId: event.target.value }))
                  }
                >
                  <option value="">Todos os Dispositivos</option>
                  {deviceOptions.map((device) => (
                    <option key={device.value} value={device.value}>
                      {device.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                className="input"
                placeholder="nome_da_variavel"
                value={newVariable.name}
                onChange={(event) => setNewVariable((prev) => ({ ...prev, name: event.target.value }))}
              />
              {isPresetVariableName(newVariable.name) ? (
                <div className="hint">Variavel do sistema. Alterar somente se souber o impacto.</div>
              ) : null}
              <div className="mini-note">Use apenas letras, numeros e _.</div>
              <textarea
                className="textarea"
                placeholder="Valor da variavel"
                value={newVariable.value}
                onChange={(event) => setNewVariable((prev) => ({ ...prev, value: event.target.value }))}
              />
              <div className="form-row">
                <button className="secondary" onClick={closeVariableModal}>
                  Cancelar
                </button>
                <button className="primary" onClick={submitVariableForm}>
                  {editingVariableId ? "Salvar" : "Criar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {flowCreateOpen ? (
        <div
          className="modal"
          onClick={(event) => {
            if (event.target.classList.contains("modal")) setFlowCreateOpen(false);
          }}
        >
          <div className="modal-card wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Criar fluxo</h3>
              <button className="icon" onClick={() => setFlowCreateOpen(false)}>
                X
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <input
                  className="input"
                  placeholder="Nome do fluxo"
                  value={newFlow.name}
                  onChange={(event) => setNewFlow((prev) => ({ ...prev, name: event.target.value }))}
                />
                <select
                  className="select"
                  value={newFlow.deviceId}
                  onChange={(event) => setNewFlow((prev) => ({ ...prev, deviceId: event.target.value }))}
                >
                  <option value="">Todos os Dispositivos</option>
                  {deviceOptions.map((device) => (
                    <option key={device.value} value={device.value}>
                      {device.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flow-switch inline">
                <span>Ativo</span>
                <input
                  type="checkbox"
                  checked={newFlow.enabled}
                  onChange={(event) => setNewFlow((prev) => ({ ...prev, enabled: event.target.checked }))}
                />
              </label>
              <div className="form-row">
                <textarea
                  className="textarea"
                  placeholder="Gatilhos JSON"
                  value={newFlow.triggers}
                  onChange={(event) => setNewFlow((prev) => ({ ...prev, triggers: event.target.value }))}
                />
                <textarea
                  className="textarea"
                  placeholder="Etapas JSON"
                  value={newFlow.stages}
                  onChange={(event) => setNewFlow((prev) => ({ ...prev, stages: event.target.value }))}
                />
              </div>
              <div className="form-row">
                <button className="secondary" onClick={() => setFlowCreateOpen(false)}>
                  Cancelar
                </button>
                <button className="primary" onClick={submitFlowCreate}>
                  Criar fluxo
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {qrModal.open ? (
        <div className="modal" onClick={() => setQrModal(EMPTY_QR_MODAL)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>QR - {qrModal.device?.name || "Sessao"}</h3>
              <button className="icon" onClick={() => setQrModal(EMPTY_QR_MODAL)}>
                X
              </button>
            </div>
            <div className="modal-body">
              <div className="qr-modal">
                <div className="qr-info">
                  <div className="qr-title">Escaneie o QR abaixo.</div>
                  <div className="qr-notice">QR ativo por 2 minutos.</div>
                  <div className="qr-timer">{formatCountdown(qrRemaining)}</div>
                </div>
                <div className={`qr-box ${qrExpired ? "expired" : ""}`}>
                  {qrModal.imageUrl ? <img src={qrModal.imageUrl} alt="QR" /> : null}
                </div>
                <div className="qr-status">
                  {qrModal.message || (qrModal.imageUrl ? "Escaneie o QR abaixo." : "Gerando QR...")}
                </div>
                <div className="form-row qr-actions">
                  <button className="secondary" onClick={regenerateQr}>
                    Gerar novo QR
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {detailModal.open ? (
        <div
          className="modal"
          onClick={(event) => {
            if (event.target.classList.contains("modal")) {
              setDetailModal({ open: false, title: "", content: null });
            }
          }}
        >
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{detailModal.title}</h3>
              <button className="icon" onClick={() => setDetailModal({ open: false, title: "", content: null })}>
                X
              </button>
            </div>
            <div className="modal-body">{detailModal.content}</div>
          </div>
        </div>
      ) : null}

      {auth.status !== "ready" ? (
        <div className="login-screen">
          <div className="login-card">
            <h2>Login</h2>
            <p>Entre para acessar o painel.</p>
            <form
              onSubmit={handleLogin}
              style={{ display: "grid", gap: 10, marginTop: 8 }}
            >
              <input
                className="input"
                placeholder="Usuario"
                value={loginForm.username}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, username: event.target.value }))}
              />
              <input
                className="input"
                type="password"
                placeholder="Senha"
                value={loginForm.password}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
              />
              {loginForm.error ? <div className="hint">{loginForm.error}</div> : null}
              <button className="primary" type="submit">
                Entrar
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
