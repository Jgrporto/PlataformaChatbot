import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  Handle,
  Position,
  useEdgesState,
  useNodesState
} from "reactflow";

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
    id: "atendimento",
    title: "Atendimento",
    subtitle: "Listagem e acompanhamento dos atendimentos."
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
    title: "Fluxos de Chatbot",
    subtitle: "Gerencie e edite fluxos visuais do chatbot."
  },
  {
    id: "followups",
    title: "Follow-ups",
    subtitle: "Reatribua dispositivos e acompanhe retornos."
  },
  {
    id: "tests",
    title: "Requisicoes NEWBR",
    subtitle: "Execucoes registradas da API NewBR."
  }
];

const DASHBOARD_RANGES = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Ultimos 7 dias" },
  { value: "30d", label: "Ultimos 30 dias" }
];

const ATTENDANCE_RANGES = [
  { value: "", label: "Todos" },
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Ultimos 7 dias" },
  { value: "30d", label: "Ultimos 30 dias" }
];

const ATTENDANCE_PAGE_SIZE = 8;
const REPLY_PAGE_SIZE = 6;

const MATCH_LABELS = {
  includes: "Contem",
  exact: "Frase exata",
  starts_with: "Comeca",
  list: "Lista"
};

const FLOW_ACTIONS = [
  { type: "text", label: "Enviar Texto" },
  { type: "image", label: "Enviar Imagem" },
  { type: "video", label: "Enviar Video" },
  { type: "audio", label: "Enviar Audio" },
  { type: "document", label: "Enviar Documento" },
  { type: "responses", label: "Respostas" },
  { type: "list", label: "Enviar Lista" }
];

const FLOW_ACTION_MAP = FLOW_ACTIONS.reduce((acc, item) => {
  acc[item.type] = item;
  return acc;
}, {});

const FLOW_META_MARKER = "__flow_meta";
const FLOW_START_NODE_ID = "flow-start";

const FLOW_REACTIVATION_UNITS = [
  { value: "minutes", label: "Minutos" },
  { value: "hours", label: "Horas" },
  { value: "days", label: "Dias" }
];

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

const APP_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function buildAppPath(pathname) {
  const suffix = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (!APP_BASE || APP_BASE === "/") return suffix;
  return `${APP_BASE}${suffix}`;
}

function parseAtendimentoPath(pathname) {
  const base = APP_BASE && APP_BASE !== "/" ? APP_BASE : "";
  let path = pathname || "/";
  if (base && path.startsWith(base)) path = path.slice(base.length);
  if (!path.startsWith("/")) path = `/${path}`;
  if (path === "/atendimento") {
    return { view: "atendimento", attendanceId: null };
  }
  const detailPrefix = "/atendimento/visualizar/";
  if (path.startsWith(detailPrefix)) {
    const id = path.slice(detailPrefix.length).trim();
    if (id) {
      return { view: "atendimento", attendanceId: id };
    }
  }
  return null;
}

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

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatValue(value) {
  if (value === 0) return "0";
  return value ? String(value) : "--";
}

function getAttendanceStatusMeta(status) {
  if (status === "closed") {
    return {
      label: "Finalizado",
      pill: "danger",
      header: "Finalizado",
      situation: "Finalizado"
    };
  }
  return {
    label: "Ativo",
    pill: "success",
    header: "Em atendimento",
    situation: "Nao finalizado"
  };
}

function buildDeviceLabel(device) {
  if (!device) return "Device";
  const phone = device.devicePhone ? ` (${device.devicePhone})` : "";
  return `${device.name || device.id}${phone}`;
}

function getMatchLabel(value) {
  return MATCH_LABELS[value] || value || "Custom";
}

function buildDefaultFlowMeta() {
  return {
    __type: FLOW_META_MARKER,
    version: 1,
    triggers: {
      anyMessage: false,
      keywordMessage: true,
      firstMessageDay: false,
      firstMessage: false
    },
    reactivation: {
      value: 0,
      unit: "minutes"
    },
    rules: {
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
    }
  };
}

function normalizeFlowMeta(meta) {
  const base = buildDefaultFlowMeta();
  if (!meta || typeof meta !== "object") return base;
  const normalized = {
    ...base,
    triggers: { ...base.triggers, ...(meta.triggers || {}) },
    reactivation: { ...base.reactivation, ...(meta.reactivation || {}) },
    rules: { ...base.rules, ...(meta.rules || {}) }
  };
  normalized.__type = FLOW_META_MARKER;
  normalized.version = base.version;
  const allowedUnits = new Set(FLOW_REACTIVATION_UNITS.map((unit) => unit.value));
  if (!allowedUnits.has(normalized.reactivation.unit)) {
    normalized.reactivation.unit = base.reactivation.unit;
  }
  const value = Number(normalized.reactivation.value);
  normalized.reactivation.value = Number.isNaN(value) || value < 0 ? 0 : value;
  return normalized;
}

function splitFlowTriggers(triggers) {
  const list = Array.isArray(triggers) ? triggers : [];
  const keywords = [];
  let meta = null;
  list.forEach((item) => {
    if (item && typeof item === "object" && item.__type === FLOW_META_MARKER) {
      meta = item;
      return;
    }
    if (typeof item === "string") {
      const value = item.trim();
      if (value) keywords.push(value);
    }
  });
  return { keywords, meta: normalizeFlowMeta(meta) };
}

function buildTriggerPayload(keywords, meta) {
  const list = Array.isArray(keywords) ? keywords : [];
  const cleaned = list
    .map((item) => String(item || "").trim())
    .filter((item) => item);
  return [...cleaned, normalizeFlowMeta(meta)];
}

function buildFlowMetaFromState(ruleState, reactivation) {
  const meta = buildDefaultFlowMeta();
  meta.triggers = {
    ...meta.triggers,
    anyMessage: !!ruleState?.anyMessage,
    keywordMessage: !!ruleState?.keywordMessage,
    firstMessageDay: !!ruleState?.firstMessageDay,
    firstMessage: !!ruleState?.firstMessage
  };
  meta.rules = {
    ...meta.rules,
    allowGroups: !!ruleState?.allowGroups,
    scheduleOnly: !!ruleState?.scheduleOnly,
    ignoreOpen: !!ruleState?.ignoreOpen,
    customSignature: !!ruleState?.customSignature,
    simulateTyping: !!ruleState?.simulateTyping,
    crmIgnore: !!ruleState?.crmIgnore,
    crmIgnoreAll: !!ruleState?.crmIgnoreAll,
    crmOnly: !!ruleState?.crmOnly,
    tagIgnore: !!ruleState?.tagIgnore,
    tagIgnoreAll: !!ruleState?.tagIgnoreAll,
    tagOnly: !!ruleState?.tagOnly
  };
  meta.reactivation = {
    value: Number(reactivation?.value) || 0,
    unit: reactivation?.unit || meta.reactivation.unit
  };
  return normalizeFlowMeta(meta);
}

function buildFlowItemId(prefix) {
  const seed = Math.random().toString(16).slice(2, 10);
  return `${prefix}-${seed}`;
}

function buildDefaultNodeConfig(kind) {
  if (kind === "text") {
    return { message: "", saveVar: "", tags: [] };
  }
  if (kind === "image" || kind === "video" || kind === "document") {
    return { fileName: "", caption: "", saveVar: "" };
  }
  if (kind === "audio") {
    return { fileName: "", caption: "", saveVar: "", recording: false };
  }
  if (kind === "responses") {
    return {
      message: "",
      options: [{ id: buildFlowItemId("option"), label: "" }],
      matchType: "includes",
      saveVar: "",
      fallbackRepeat: false
    };
  }
  if (kind === "list") {
    return {
      title: "",
      description: "",
      footer: "",
      buttonText: "",
      categories: [{ id: buildFlowItemId("category"), title: "", items: [] }],
      saveVar: "",
      fallbackRepeat: false
    };
  }
  return { message: "" };
}

function normalizeOptions(options, fallback) {
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return fallback;
  return list.map((option) => ({
    id: option?.id || buildFlowItemId("option"),
    label: option?.label || option?.text || ""
  }));
}

function normalizeCategories(categories, fallback) {
  const list = Array.isArray(categories) ? categories : [];
  if (!list.length) return fallback;
  return list.map((category) => ({
    id: category?.id || buildFlowItemId("category"),
    title: category?.title || category?.name || "",
    items: Array.isArray(category?.items)
      ? category.items.map((item) => ({
          id: item?.id || buildFlowItemId("item"),
          title: item?.title || item?.label || item?.name || "",
          description: item?.description || ""
        }))
      : []
  }));
}

function normalizeStageConfig(kind, stage) {
  const base = buildDefaultNodeConfig(kind);
  if (!stage || typeof stage !== "object") return base;
  const raw = stage.data && typeof stage.data === "object" ? stage.data : stage;
  const config = { ...base, ...raw };
  if (kind === "text" || kind === "responses") {
    config.message = raw.message || raw.text || raw.label || raw.title || "";
  }
  if (kind === "responses") {
    config.options = normalizeOptions(raw.options, base.options);
  }
  if (kind === "list") {
    config.categories = normalizeCategories(raw.categories, base.categories);
  }
  return config;
}

function getNodeOutputs(kind, config) {
  if (kind === "responses") {
    const options = Array.isArray(config?.options) ? config.options : [];
    return options.map((option, index) => ({
      id: `option-${option.id || index}`,
      label: option.label || `Opcao ${index + 1}`
    }));
  }
  if (kind === "list") {
    const categories = Array.isArray(config?.categories) ? config.categories : [];
    const outputs = [];
    categories.forEach((category, cIndex) => {
      const catLabel = category.title || `Categoria ${cIndex + 1}`;
      const items = Array.isArray(category.items) ? category.items : [];
      if (items.length) {
        items.forEach((item, iIndex) => {
          const itemLabel = item.title || `Item ${iIndex + 1}`;
          outputs.push({
            id: `item-${item.id || `${cIndex}-${iIndex}`}`,
            label: `${catLabel}: ${itemLabel}`
          });
        });
      } else {
        outputs.push({
          id: `category-${category.id || cIndex}`,
          label: catLabel
        });
      }
    });
    return outputs.length ? outputs : [{ id: "next", label: "Chamar proximo" }];
  }
  return [
    { id: "next", label: "Chamar proximo" },
    { id: "reply", label: "Quando responder" }
  ];
}

function buildFlowGraphFromStages(stages) {
  const stageList = Array.isArray(stages) ? stages : [];
  const nodes = stageList.map((stage, index) => {
    let kind = "text";
    let config = buildDefaultNodeConfig("text");
    if (typeof stage === "string") {
      config = buildDefaultNodeConfig("text");
      config.message = stage;
    } else if (stage && typeof stage === "object") {
      kind = stage.type || (stage.message ? "text" : "text");
      config = normalizeStageConfig(kind, stage);
    }
    const id = stage?.id || `node-${index + 1}`;
    const rawPosition = stage?.position && typeof stage.position === "object" ? stage.position : null;
    const position = {
      x: Number(rawPosition?.x) || 0,
      y: Number(rawPosition?.y) || index * 140
    };
    return {
      id,
      type: "flowAction",
      position,
      data: {
        kind,
        label: FLOW_ACTION_MAP[kind]?.label || "Bloco",
        config
      }
    };
  });

  const nodeIds = new Set(nodes.map((node) => node.id));
  const hasConnections = stageList.some(
    (stage) => stage && typeof stage === "object" && stage.connections && Object.keys(stage.connections).length
  );
  const edges = [];

  if (hasConnections) {
    stageList.forEach((stage, index) => {
      const sourceId = nodes[index]?.id;
      if (!sourceId || !stage || typeof stage !== "object" || !stage.connections) return;
      Object.entries(stage.connections).forEach(([handle, target]) => {
        if (!target || !nodeIds.has(target)) return;
        edges.push({
          id: `edge-${sourceId}-${handle}-${target}`,
          source: sourceId,
          sourceHandle: handle,
          target,
          type: "smoothstep"
        });
      });
    });
  } else {
    for (let i = 0; i < nodes.length - 1; i += 1) {
      edges.push({
        id: `edge-${nodes[i].id}-next-${nodes[i + 1].id}`,
        source: nodes[i].id,
        sourceHandle: "next",
        target: nodes[i + 1].id,
        type: "smoothstep"
      });
    }
  }

  return { nodes, edges };
}

function sanitizeNodeConfig(kind, config) {
  const raw = config && typeof config === "object" ? { ...config } : {};
  if (kind === "responses") {
    raw.options = normalizeOptions(raw.options, []);
  }
  if (kind === "list") {
    raw.categories = normalizeCategories(raw.categories, []);
  }
  return raw;
}

function serializeFlowStages(nodes, edges) {
  const stageNodes = nodes.filter((node) => node.id !== FLOW_START_NODE_ID);
  const connectionsBySource = new Map();
  edges.forEach((edge) => {
    if (!edge.source || edge.source === FLOW_START_NODE_ID) return;
    const handle = edge.sourceHandle || "next";
    if (!connectionsBySource.has(edge.source)) {
      connectionsBySource.set(edge.source, {});
    }
    connectionsBySource.get(edge.source)[handle] = edge.target;
  });

  return stageNodes.map((node) => {
    const kind = node.data?.kind || "text";
    const config = sanitizeNodeConfig(kind, node.data?.config || {});
    const stage = {
      id: node.id,
      type: kind,
      position: node.position,
      data: config
    };
    const connections = connectionsBySource.get(node.id);
    if (connections && Object.keys(connections).length) {
      stage.connections = connections;
    }
    if (kind === "text" || kind === "responses") {
      stage.message = config.message || "";
    }
    return stage;
  });
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

function safeParseJsonArray(value) {
  try {
    return parseJsonArray(value);
  } catch {
    return [];
  }
}

function FlowNameForm({ initialName, confirmLabel, onCancel, onSubmit }) {
  const [name, setName] = useState(initialName || "");
  return (
    <div className="flow-name-form">
      <input className="input" placeholder="Nome do fluxo" value={name} onChange={(event) => setName(event.target.value)} />
      <div className="form-row">
        <button className="secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button className="primary" onClick={() => onSubmit(name)}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function getFlowNodePreview(kind, config) {
  if (kind === "text") {
    return config?.message || "Mensagem vazia";
  }
  if (kind === "image") {
    return config?.fileName ? `Imagem: ${config.fileName}` : "Imagem nao definida";
  }
  if (kind === "video") {
    return config?.fileName ? `Video: ${config.fileName}` : "Video nao definido";
  }
  if (kind === "audio") {
    return config?.fileName ? `Audio: ${config.fileName}` : "Audio nao definido";
  }
  if (kind === "document") {
    return config?.fileName ? `Documento: ${config.fileName}` : "Documento nao definido";
  }
  if (kind === "responses") {
    return config?.message || "Pergunta nao definida";
  }
  if (kind === "list") {
    return config?.title || "Lista sem titulo";
  }
  return "Bloco configuravel";
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

function isDateWithinRange(value, range) {
  if (!range) return true;
  if (!value) return false;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return false;
  const start = getRangeStart(range);
  if (!start) return true;
  return dt >= start;
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
    enabled: false,
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
  const [flowReactivation, setFlowReactivation] = useState({ value: 0, unit: "minutes" });
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
  const [flowGraphDirty, setFlowGraphDirty] = useState(false);
  const [flowNodes, setFlowNodes, onFlowNodesChange] = useNodesState([]);
  const [flowEdges, setFlowEdges, onFlowEdgesChange] = useEdgesState([]);
  const [flowInstance, setFlowInstance] = useState(null);
  const flowNodeIdRef = useRef(1);
  const flowNodesRef = useRef([]);
  const flowCanvasRef = useRef(null);
  const [flowNodeModal, setFlowNodeModal] = useState({ open: false, nodeId: null, kind: "" });
  const [flowNodeDraft, setFlowNodeDraft] = useState(null);

  const [conversations, setConversations] = useState([]);

  const [attendanceList, setAttendanceList] = useState([]);
  const [attendanceFilters, setAttendanceFilters] = useState({
    q: "",
    deviceId: "",
    entryRange: "",
    exitRange: ""
  });
  const [attendanceApplied, setAttendanceApplied] = useState({
    q: "",
    deviceId: "",
    entryRange: "",
    exitRange: ""
  });
  const [attendancePage, setAttendancePage] = useState(1);
  const [attendanceDetailsId, setAttendanceDetailsId] = useState(null);
  const [attendanceDetails, setAttendanceDetails] = useState(null);
  const [attendanceMessage, setAttendanceMessage] = useState("");
  const [attendanceDeviceId, setAttendanceDeviceId] = useState("");
  const [attendanceNow, setAttendanceNow] = useState(Date.now());

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
  const attendanceQuickReplies = useMemo(() => {
    const deviceId = attendanceDetails?.deviceId || "";
    return (replies || [])
      .filter((reply) => reply.enabled !== false)
      .filter((reply) => !reply.deviceId || !deviceId || reply.deviceId === deviceId);
  }, [replies, attendanceDetails]);
  const sortedAttendanceMessages = useMemo(() => {
    const raw = attendanceDetails?.messages || [];
    return raw
      .map((msg, index) => ({ msg, index }))
      .sort((left, right) => {
        const timeLeft = new Date(left.msg.createdAt).getTime();
        const timeRight = new Date(right.msg.createdAt).getTime();
        const hasTimeLeft = Number.isFinite(timeLeft);
        const hasTimeRight = Number.isFinite(timeRight);

        if (hasTimeLeft && hasTimeRight && timeLeft !== timeRight) {
          return timeLeft - timeRight;
        }
        if (hasTimeLeft !== hasTimeRight) {
          return hasTimeLeft ? -1 : 1;
        }

        const originLeft = (left.msg.origin || "").toUpperCase();
        const originRight = (right.msg.origin || "").toUpperCase();
        const agentLeft = originLeft === "AGENTE";
        const agentRight = originRight === "AGENTE";
        const botLeft = originLeft === "BOT";
        const botRight = originRight === "BOT";
        if ((agentLeft && botRight) || (botLeft && agentRight)) {
          return agentLeft ? -1 : 1;
        }

        const idLeft = Number(left.msg.id);
        const idRight = Number(right.msg.id);
        if (Number.isFinite(idLeft) && Number.isFinite(idRight) && idLeft !== idRight) {
          return idLeft - idRight;
        }

        return left.index - right.index;
      })
      .map((entry) => entry.msg);
  }, [attendanceDetails]);
  const filteredAttendances = useMemo(() => {
    const query = attendanceApplied.q.trim().toLowerCase();
    const deviceId = attendanceApplied.deviceId;
    const entryRange = attendanceApplied.entryRange;
    const exitRange = attendanceApplied.exitRange;
    return attendanceList.filter((item) => {
      if (deviceId && item.deviceId !== deviceId) return false;
      if (entryRange && !isDateWithinRange(item.startedAt, entryRange)) return false;
      if (exitRange && !isDateWithinRange(item.closedAt, exitRange)) return false;
      if (query) {
        const haystack = `${item.name || ""} ${item.phone || ""} ${item.protocol || ""} ${
          item.deviceName || ""
        } ${item.deviceId || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [attendanceList, attendanceApplied]);
  const attendancePageCount = useMemo(() => {
    return Math.max(1, Math.ceil(filteredAttendances.length / ATTENDANCE_PAGE_SIZE));
  }, [filteredAttendances.length]);
  const pagedAttendances = useMemo(() => {
    const start = (attendancePage - 1) * ATTENDANCE_PAGE_SIZE;
    return filteredAttendances.slice(start, start + ATTENDANCE_PAGE_SIZE);
  }, [filteredAttendances, attendancePage]);
  const flowTriggerList = useMemo(() => {
    const parsed = safeParseJsonArray(flowDraft.triggers);
    return splitFlowTriggers(parsed).keywords;
  }, [flowDraft.triggers]);
  const flowStageParsed = useMemo(() => {
    try {
      return { stages: parseJsonArray(flowDraft.stages), error: "" };
    } catch (err) {
      return { stages: [], error: err.message || "JSON invalido" };
    }
  }, [flowDraft.stages]);
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
    const data = await api("/api/conversations");
    setConversations(data || []);
  }, []);

  const loadAttendanceList = useCallback(
    async (filters = attendanceApplied) => {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.deviceId) params.set("deviceId", filters.deviceId);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const data = await api(`/api/conversations${suffix}`);
      setAttendanceList(data || []);
    },
    [attendanceApplied]
  );

  const loadAttendanceDetails = useCallback(async (id) => {
    if (!id) return;
    const data = await api(`/api/conversations/${id}`);
    setAttendanceDetails(data || null);
    setAttendanceDeviceId(data?.deviceId || "");
  }, []);

  const loadQuickReplies = useCallback(async () => {
    const data = await api("/api/chatbot/quick-replies");
    setReplies(data || []);
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
    const route = parseAtendimentoPath(window.location.pathname);
    if (!route) return;
    setActiveView(route.view);
    setAttendanceDetailsId(route.attendanceId || null);
  }, []);

  useEffect(() => {
    const handlePop = () => {
      const route = parseAtendimentoPath(window.location.pathname);
      if (!route) return;
      setActiveView(route.view);
      setAttendanceDetailsId(route.attendanceId || null);
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

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
    if (activeView === "atendimento") {
      loadAttendanceList().catch(() => {});
      loadQuickReplies().catch(() => {});
    }
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
    loadAttendanceList,
    loadQuickReplies,
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
      if (activeView === "atendimento") loadAttendanceList().catch(() => {});
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
    loadAttendanceList,
    loadTests,
    loadFollowups,
    loadInteractions
  ]);

  useEffect(() => {
    if (!attendanceDetailsId) {
      setAttendanceDetails(null);
      return;
    }
    if (auth.status !== "ready") return;
    loadAttendanceDetails(attendanceDetailsId).catch(() => {});
  }, [attendanceDetailsId, loadAttendanceDetails, auth.status]);

  useEffect(() => {
    if (attendancePage > attendancePageCount) {
      setAttendancePage(attendancePageCount);
    }
  }, [attendancePage, attendancePageCount]);

  useEffect(() => {
    if (activeView !== "atendimento") return;
    const interval = setInterval(() => {
      setAttendanceNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [activeView]);

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
      const meta = buildDefaultFlowMeta();
      setFlowRuleState((prev) => ({
        ...prev,
        ...meta.triggers,
        ...meta.rules
      }));
      setFlowReactivation(meta.reactivation);
      setFlowNodes([]);
      setFlowEdges([]);
      setFlowGraphDirty(false);
      return;
    }
    const { keywords, meta } = splitFlowTriggers(selectedFlow.triggers || []);
    setFlowDraft({
      name: selectedFlow.name || "",
      triggers: JSON.stringify(buildTriggerPayload(keywords, meta), null, 2),
      stages: JSON.stringify(selectedFlow.stages || [], null, 2),
      flowType: selectedFlow.flowType || "custom",
      enabled: !!selectedFlow.enabled,
      deviceId: selectedFlow.deviceId || ""
    });
    setFlowRuleState((prev) => ({
      ...prev,
      ...meta.triggers,
      ...meta.rules
    }));
    setFlowReactivation(meta.reactivation);
    const graph = buildFlowGraphFromStages(selectedFlow.stages || []);
    const startNode = {
      id: FLOW_START_NODE_ID,
      type: "flowStart",
      position: { x: -220, y: 0 },
      draggable: false,
      selectable: false,
      data: { label: "Inicio" }
    };
    const startEdge = graph.nodes.length
      ? [
          {
            id: `edge-${FLOW_START_NODE_ID}-${graph.nodes[0].id}`,
            source: FLOW_START_NODE_ID,
            sourceHandle: "next",
            target: graph.nodes[0].id,
            type: "smoothstep"
          }
        ]
      : [];
    setFlowNodes([startNode, ...graph.nodes]);
    setFlowEdges([...startEdge, ...graph.edges]);
    flowNodeIdRef.current = graph.nodes.length + 1;
    setFlowGraphDirty(false);
    setFlowError("");
  }, [selectedFlow]);

  useEffect(() => {
    flowNodesRef.current = flowNodes;
  }, [flowNodes]);

  useEffect(() => {
    const meta = buildFlowMetaFromState(flowRuleState, flowReactivation);
    setFlowDraft((prev) => {
      const current = safeParseJsonArray(prev.triggers);
      const { keywords } = splitFlowTriggers(current);
      const nextValue = JSON.stringify(buildTriggerPayload(keywords, meta), null, 2);
      if (nextValue === prev.triggers) return prev;
      return { ...prev, triggers: nextValue };
    });
  }, [flowRuleState, flowReactivation]);

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
    const meta = buildFlowMetaFromState(flowRuleState, flowReactivation);
    const payload = buildTriggerPayload(next, meta);
    setFlowDraft((prev) => ({ ...prev, triggers: JSON.stringify(payload, null, 2) }));
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

  const getNextFlowNodeId = useCallback(() => {
    const next = flowNodeIdRef.current;
    flowNodeIdRef.current += 1;
    return `node-${next}`;
  }, []);

  const createFlowNode = useCallback(
    (kind, position) => {
      const label = FLOW_ACTION_MAP[kind]?.label || "Bloco";
      const config = buildDefaultNodeConfig(kind);
      return {
        id: getNextFlowNodeId(),
        type: "flowAction",
        position,
        data: {
          kind,
          label,
          config
        }
      };
    },
    [getNextFlowNodeId]
  );

  const handleFlowNodesChange = useCallback(
    (changes) => {
      onFlowNodesChange(changes);
      if (changes.some((change) => change.type !== "select")) {
        setFlowGraphDirty(true);
      }
    },
    [onFlowNodesChange]
  );

  const handleFlowEdgesChange = useCallback(
    (changes) => {
      onFlowEdgesChange(changes);
      if (changes.some((change) => change.type !== "select")) {
        setFlowGraphDirty(true);
      }
    },
    [onFlowEdgesChange]
  );

  const handleFlowConnect = useCallback((params) => {
    if (!params.source) return;
    setFlowEdges((eds) => {
      const filtered = eds.filter(
        (edge) => !(edge.source === params.source && edge.sourceHandle === params.sourceHandle)
      );
      return addEdge({ ...params, type: "smoothstep" }, filtered);
    });
    setFlowGraphDirty(true);
  }, []);

  const handleFlowDragStart = (event, kind) => {
    event.dataTransfer.setData("application/flow-action", kind);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleFlowDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleFlowDrop = useCallback(
    (event) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData("application/flow-action");
      if (!kind || !flowInstance || !flowCanvasRef.current) return;
      const bounds = flowCanvasRef.current.getBoundingClientRect();
      const position = flowInstance.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      });
      const node = createFlowNode(kind, position);
      setFlowNodes((nds) => nds.concat(node));
      setFlowGraphDirty(true);
    },
    [flowInstance, createFlowNode, setFlowNodes]
  );

  const openFlowNodeModal = useCallback((nodeId) => {
    const node = flowNodesRef.current.find((item) => item.id === nodeId);
    if (!node || node.id === FLOW_START_NODE_ID) return;
    const kind = node.data?.kind || "text";
    const config = sanitizeNodeConfig(kind, node.data?.config || {});
    setFlowNodeDraft(JSON.parse(JSON.stringify(config)));
    setFlowNodeModal({ open: true, nodeId, kind });
  }, []);

  const closeFlowNodeModal = () => {
    setFlowNodeModal({ open: false, nodeId: null, kind: "" });
    setFlowNodeDraft(null);
  };

  const saveFlowNodeDraft = () => {
    if (!flowNodeModal.nodeId || !flowNodeDraft) return;
    setFlowNodes((nodes) =>
      nodes.map((node) =>
        node.id === flowNodeModal.nodeId
          ? { ...node, data: { ...node.data, config: flowNodeDraft } }
          : node
      )
    );
    setFlowGraphDirty(true);
    closeFlowNodeModal();
  };

  const updateFlowNodeDraft = (patch) => {
    setFlowNodeDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, ...patch };
    });
  };

  const handleFlowFileChange = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    updateFlowNodeDraft({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size
    });
  };

  const addFlowResponseOption = () => {
    setFlowNodeDraft((prev) => {
      if (!prev) return prev;
      const options = Array.isArray(prev.options) ? prev.options : [];
      return {
        ...prev,
        options: [...options, { id: buildFlowItemId("option"), label: "" }]
      };
    });
  };

  const updateFlowResponseOption = (id, value) => {
    setFlowNodeDraft((prev) => {
      if (!prev) return prev;
      const options = Array.isArray(prev.options) ? prev.options : [];
      return {
        ...prev,
        options: options.map((option) => (option.id === id ? { ...option, label: value } : option))
      };
    });
  };

  const removeFlowResponseOption = (id) => {
    setFlowNodeDraft((prev) => {
      if (!prev) return prev;
      const options = Array.isArray(prev.options) ? prev.options : [];
      return {
        ...prev,
        options: options.filter((option) => option.id !== id)
      };
    });
  };

  const addFlowListCategory = () => {
    setFlowNodeDraft((prev) => {
      if (!prev) return prev;
      const categories = Array.isArray(prev.categories) ? prev.categories : [];
      if (categories.length >= 10) return prev;
      return {
        ...prev,
        categories: [...categories, { id: buildFlowItemId("category"), title: "", items: [] }]
      };
    });
  };

  const updateFlowListCategory = (id, value) => {
    setFlowNodeDraft((prev) => {
      if (!prev) return prev;
      const categories = Array.isArray(prev.categories) ? prev.categories : [];
      return {
        ...prev,
        categories: categories.map((category) =>
          category.id === id ? { ...category, title: value } : category
        )
      };
    });
  };

  const removeFlowListCategory = (id) => {
    setFlowNodeDraft((prev) => {
      if (!prev) return prev;
      const categories = Array.isArray(prev.categories) ? prev.categories : [];
      return {
        ...prev,
        categories: categories.filter((category) => category.id !== id)
      };
    });
  };

  const addFlowListItem = (categoryId) => {
    setFlowNodeDraft((prev) => {
      if (!prev) return prev;
      const categories = Array.isArray(prev.categories) ? prev.categories : [];
      return {
        ...prev,
        categories: categories.map((category) => {
          if (category.id !== categoryId) return category;
          const items = Array.isArray(category.items) ? category.items : [];
          return {
            ...category,
            items: [...items, { id: buildFlowItemId("item"), title: "", description: "" }]
          };
        })
      };
    });
  };

  const updateFlowListItem = (categoryId, itemId, field, value) => {
    setFlowNodeDraft((prev) => {
      if (!prev) return prev;
      const categories = Array.isArray(prev.categories) ? prev.categories : [];
      return {
        ...prev,
        categories: categories.map((category) => {
          if (category.id !== categoryId) return category;
          const items = Array.isArray(category.items) ? category.items : [];
          return {
            ...category,
            items: items.map((item) =>
              item.id === itemId ? { ...item, [field]: value } : item
            )
          };
        })
      };
    });
  };

  const removeFlowListItem = (categoryId, itemId) => {
    setFlowNodeDraft((prev) => {
      if (!prev) return prev;
      const categories = Array.isArray(prev.categories) ? prev.categories : [];
      return {
        ...prev,
        categories: categories.map((category) => {
          if (category.id !== categoryId) return category;
          const items = Array.isArray(category.items) ? category.items : [];
          return {
            ...category,
            items: items.filter((item) => item.id !== itemId)
          };
        })
      };
    });
  };

  const deleteFlowNode = useCallback((nodeId) => {
    if (!nodeId || nodeId === FLOW_START_NODE_ID) return;
    setFlowNodes((nodes) => nodes.filter((node) => node.id !== nodeId));
    setFlowEdges((edges) => edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setFlowGraphDirty(true);
  }, []);

  const applyFlowStagesJson = () => {
    const nextStages = flowStageParsed.stages;
    const graph = buildFlowGraphFromStages(nextStages);
    const startNode = {
      id: FLOW_START_NODE_ID,
      type: "flowStart",
      position: { x: -220, y: 0 },
      draggable: false,
      selectable: false,
      data: { label: "Inicio" }
    };
    const startEdge = graph.nodes.length
      ? [
          {
            id: `edge-${FLOW_START_NODE_ID}-${graph.nodes[0].id}`,
            source: FLOW_START_NODE_ID,
            sourceHandle: "next",
            target: graph.nodes[0].id,
            type: "smoothstep"
          }
        ]
      : [];
    setFlowNodes([startNode, ...graph.nodes]);
    setFlowEdges([...startEdge, ...graph.edges]);
    flowNodeIdRef.current = graph.nodes.length + 1;
    setFlowGraphDirty(true);
  };

  const openFlowEditor = (flow) => {
    setSelectedFlowId(flow.id);
    setFlowEditorOpen(true);
    setFlowTriggerInput("");
    setFlowJsonOpen(false);
    setFlowError("");
    setFlowGraphDirty(false);
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
      await loadFlows();
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
      const stages = serializeFlowStages(flowNodes, flowEdges);
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
      setFlowDraft((prev) => ({ ...prev, stages: JSON.stringify(stages, null, 2) }));
      setFlowGraphDirty(false);
      await loadFlows();
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
      await loadFlows();
    } catch (err) {
      alert(err.message || "Erro ao excluir fluxo.");
    }
  };

  const buildFlowPayload = (flow, overrides = {}) => {
    const payload = {
      name: overrides.name ?? flow?.name ?? "",
      triggers: Array.isArray(overrides.triggers ?? flow?.triggers) ? overrides.triggers ?? flow?.triggers : [],
      stages: Array.isArray(overrides.stages ?? flow?.stages) ? overrides.stages ?? flow?.stages : [],
      flowType: overrides.flowType ?? flow?.flowType ?? "custom",
      enabled: overrides.enabled ?? flow?.enabled ?? false,
      deviceId: overrides.deviceId ?? flow?.deviceId ?? null
    };
    return payload;
  };

  const closeDetailModal = () => {
    setDetailModal({ open: false, title: "", content: null });
  };

  const updateFlowPayload = async (flow, payload) => {
    if (!flow?.id) return;
    await api(`/api/chatbot/flows/${flow.id}`, { method: "PUT", body: JSON.stringify(payload) });
    await loadFlows();
  };

  const toggleFlowEnabled = async (flow) => {
    try {
      const payload = buildFlowPayload(flow, { enabled: !flow.enabled });
      await updateFlowPayload(flow, payload);
    } catch (err) {
      alert(err.message || "Erro ao atualizar fluxo.");
    }
  };

  const renameFlow = async (flow, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) {
      alert("Nome do fluxo obrigatorio.");
      return;
    }
    try {
      const payload = buildFlowPayload(flow, { name: trimmed });
      await updateFlowPayload(flow, payload);
      closeDetailModal();
    } catch (err) {
      alert(err.message || "Erro ao renomear fluxo.");
    }
  };

  const duplicateFlow = async (flow, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) {
      alert("Nome do fluxo obrigatorio.");
      return;
    }
    try {
      const payload = buildFlowPayload(flow, { name: trimmed });
      await api("/api/chatbot/flows", { method: "POST", body: JSON.stringify(payload) });
      await loadFlows();
      closeDetailModal();
    } catch (err) {
      alert(err.message || "Erro ao duplicar fluxo.");
    }
  };

  const openFlowRenameModal = (flow) => {
    if (!flow) return;
    setDetailModal({
      open: true,
      title: "Renomear fluxo",
      content: (
        <FlowNameForm
          initialName={flow.name || ""}
          confirmLabel="Renomear"
          onCancel={closeDetailModal}
          onSubmit={(value) => renameFlow(flow, value)}
        />
      )
    });
  };

  const openFlowDuplicateModal = (flow) => {
    if (!flow) return;
    const fallbackName = flow.name ? `${flow.name} copia` : "Fluxo copia";
    setDetailModal({
      open: true,
      title: "Duplicar fluxo",
      content: (
        <FlowNameForm
          initialName={fallbackName}
          confirmLabel="Duplicar"
          onCancel={closeDetailModal}
          onSubmit={(value) => duplicateFlow(flow, value)}
        />
      )
    });
  };

  const applyAttendanceFilters = () => {
    const next = { ...attendanceFilters };
    setAttendanceApplied(next);
    setAttendancePage(1);
    loadAttendanceList(next).catch(() => {});
  };

  const clearAttendanceFilters = () => {
    const cleared = { q: "", deviceId: "", entryRange: "", exitRange: "" };
    setAttendanceFilters(cleared);
    setAttendanceApplied(cleared);
    setAttendancePage(1);
    loadAttendanceList(cleared).catch(() => {});
  };

  const openAttendanceDetails = (id) => {
    if (!id) return;
    setAttendanceDetails(null);
    setAttendanceMessage("");
    setAttendanceDetailsId(id);
    setActiveView("atendimento");
    try {
      window.history.pushState(
        { view: "atendimento", attendanceId: id },
        "",
        buildAppPath(`/atendimento/visualizar/${id}`)
      );
    } catch {
      // ignore
    }
  };

  const showAttendanceList = () => {
    setAttendanceDetailsId(null);
    setAttendanceDetails(null);
    setAttendanceMessage("");
    setActiveView("atendimento");
    try {
      window.history.pushState({ view: "atendimento" }, "", buildAppPath("/atendimento"));
    } catch {
      // ignore
    }
  };

  const sendAttendanceMessage = async (text) => {
    if (!attendanceDetails) return;
    const message = typeof text === "string" ? text.trim() : attendanceMessage.trim();
    if (!message) return;
    const deviceId = attendanceDeviceId || attendanceDetails.deviceId || "";
    if (!deviceId) {
      alert("Device nao definido.");
      return;
    }
    try {
      await api(`/api/conversations/${attendanceDetails.id}/send`, {
        method: "POST",
        body: JSON.stringify({ message, deviceId })
      });
      if (typeof text !== "string") {
        setAttendanceMessage("");
      }
      await loadAttendanceDetails(attendanceDetails.id);
      await loadAttendanceList();
    } catch (err) {
      alert(err.message || "Erro ao enviar mensagem.");
    }
  };

  const closeAttendanceById = async (id) => {
    if (!id) return;
    if (!confirm("Finalizar este atendimento?")) return;
    try {
      await api(`/api/conversations/${id}/close`, { method: "POST" });
      if (String(attendanceDetailsId) === String(id)) {
        await loadAttendanceDetails(id);
      }
      await loadAttendanceList();
    } catch (err) {
      alert(err.message || "Erro ao finalizar atendimento.");
    }
  };

  const closeAttendanceDetails = async () => {
    if (!attendanceDetails) return;
    await closeAttendanceById(attendanceDetails.id);
  };

  const copyToClipboard = async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(String(value));
    } catch {
      alert("Falha ao copiar.");
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

  const handleNavClick = (viewId) => {
    if (viewId === "atendimento") {
      showAttendanceList();
      return;
    }
    setActiveView(viewId);
    if (window.location.pathname.includes("/atendimento")) {
      try {
        window.history.pushState({ view: viewId }, "", buildAppPath("/"));
      } catch {
        // ignore
      }
    }
  };

  const FlowStartNode = ({ data }) => {
    return (
      <div className="flow-node flow-node-start">
        <div className="flow-node-title">{data?.label || "Inicio"}</div>
        <div className="flow-node-meta">Entrada principal</div>
        <Handle type="source" position={Position.Right} id="next" className="flow-handle" />
      </div>
    );
  };

  const FlowActionNode = ({ id, data }) => {
    const kind = data?.kind || "text";
    const config = data?.config || {};
    const outputs = getNodeOutputs(kind, config);
    const preview = getFlowNodePreview(kind, config);
    const saveVar = config.saveVar || "";
    const outputTop = 44;
    const outputGap = 18;

    return (
      <div className="flow-node flow-node-action">
        <div className="flow-node-head">
          <div className="flow-node-title">{data?.label || "Bloco"}</div>
          <div className="flow-node-actions">
            <button className="flow-node-btn" onClick={() => openFlowNodeModal(id)}>
              Editar
            </button>
            <button className="flow-node-btn danger" onClick={() => deleteFlowNode(id)}>
              Excluir
            </button>
          </div>
        </div>
        <div className="flow-node-preview">{preview}</div>
        {saveVar ? <div className="flow-node-meta">Salvar em: {saveVar}</div> : null}
        {kind === "responses" ? (
          <div className="flow-node-meta">{config.options?.length || 0} opcoes</div>
        ) : null}
        {kind === "list" ? (
          <div className="flow-node-meta">{config.categories?.length || 0} categorias</div>
        ) : null}
        <Handle type="target" position={Position.Left} id="in" className="flow-handle" />
        {outputs.map((output, index) => {
          const top = outputTop + index * outputGap;
          return (
            <React.Fragment key={output.id}>
              <Handle
                type="source"
                position={Position.Right}
                id={output.id}
                className="flow-handle"
                style={{ top }}
              />
              <span className="flow-handle-label" style={{ top: top - 6 }}>
                {output.label}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  const flowNodeTypes = {
    flowAction: FlowActionNode,
    flowStart: FlowStartNode
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
  const attendanceStatus = getAttendanceStatusMeta(attendanceDetails?.status);
  const attendanceAgentLabel = attendanceDetails
    ? deviceLabelMap.get(attendanceDetails.deviceId) ||
      attendanceDetails.deviceName ||
      attendanceDetails.deviceId ||
      "Sem agente"
    : "Sem agente";
  const attendanceClosed = attendanceDetails?.status === "closed";
  const flowNodeCategories = Array.isArray(flowNodeDraft?.categories) ? flowNodeDraft.categories : [];
  const flowNodeItemsCount = flowNodeCategories.reduce((acc, category) => {
    const count = Array.isArray(category.items) ? category.items.length : 0;
    return acc + count;
  }, 0);

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
              onClick={() => handleNavClick(view.id)}
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
          <div className="card flow-list-card">
            <div className="card-head flow-list-head">
              <div className="flow-list-title">
                <h3>Fluxos de Chatbot</h3>
                <span className="badge">Versao Beta</span>
              </div>
              <div className="form-row">
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
              </div>
            </div>
            <div className="flow-list-grid">
              <button className="flow-card flow-create-card" onClick={() => setFlowCreateOpen(true)} type="button">
                <div className="flow-create-icon">+</div>
                <div className="flow-create-text">Criar novo fluxo</div>
              </button>
              {flows.length === 0 ? (
                <div className="flow-card flow-empty-card">
                  <div className="flow-empty-text">Nenhum fluxo cadastrado.</div>
                  <div className="device-meta">Crie um fluxo para comecar a desenhar a logica.</div>
                </div>
              ) : (
                flows.map((flow) => {
                  const { keywords } = splitFlowTriggers(flow.triggers || []);
                  return (
                    <div
                      key={flow.id}
                      className="flow-card flow-card-item"
                      onClick={() => openFlowEditor(flow)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") openFlowEditor(flow);
                      }}
                    >
                      <div className="flow-card-head">
                        <div className="flow-card-info">
                          <div className="flow-bot-icon">BOT</div>
                          <div>
                            <div className="flow-title">{flow.name || "Sem nome"}</div>
                            <div className="flow-card-meta">
                              <span className={`pill ${flow.enabled ? "success" : "danger"}`}>
                                {flow.enabled ? "Ativo" : "Inativo"}
                              </span>
                              <span className="device-meta">
                                {keywords.length} gatilhos • {(flow.stages || []).length} blocos
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flow-card-actions" onClick={(event) => event.stopPropagation()}>
                          <label className="flow-card-toggle">
                            <input
                              type="checkbox"
                              checked={!!flow.enabled}
                              onChange={() => toggleFlowEnabled(flow)}
                            />
                            <span className="flow-card-slider" />
                          </label>
                          <details className="flow-card-menu">
                            <summary className="icon">...</summary>
                            <div className="flow-card-menu-list">
                              <button type="button" onClick={() => openFlowRenameModal(flow)}>
                                Renomear
                              </button>
                              <button type="button" onClick={() => openFlowDuplicateModal(flow)}>
                                Duplicar
                              </button>
                              <button type="button" className="flow-menu-danger" onClick={() => deleteFlow(flow.id)}>
                                Excluir
                              </button>
                            </div>
                          </details>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className={`view ${activeView === "atendimento" ? "active" : ""}`}>
          {!attendanceDetailsId ? (
            <>
              <div className="card">
                <div className="card-head">
                  <h3>Atendimento</h3>
                </div>
                <div className="attendance-filter-bar">
                  <div className="attendance-filter-fields">
                    <input
                      className="input"
                      placeholder="Busca por filtro"
                      value={attendanceFilters.q}
                      onChange={(event) =>
                        setAttendanceFilters((prev) => ({ ...prev, q: event.target.value }))
                      }
                    />
                    <select
                      className="select"
                      value={attendanceFilters.deviceId}
                      onChange={(event) =>
                        setAttendanceFilters((prev) => ({ ...prev, deviceId: event.target.value }))
                      }
                    >
                      <option value="">Agente (Dispositivo)</option>
                      {deviceOptions.map((device) => (
                        <option key={device.value} value={device.value}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="select"
                      value={attendanceFilters.entryRange}
                      onChange={(event) =>
                        setAttendanceFilters((prev) => ({ ...prev, entryRange: event.target.value }))
                      }
                    >
                      <option value="">Entrada</option>
                      {ATTENDANCE_RANGES.filter((range) => range.value).map((range) => (
                        <option key={`entry-${range.value}`} value={range.value}>
                          {range.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="select"
                      value={attendanceFilters.exitRange}
                      onChange={(event) =>
                        setAttendanceFilters((prev) => ({ ...prev, exitRange: event.target.value }))
                      }
                    >
                      <option value="">Termino</option>
                      {ATTENDANCE_RANGES.filter((range) => range.value).map((range) => (
                        <option key={`exit-${range.value}`} value={range.value}>
                          {range.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="attendance-filter-actions">
                    <button className="primary" onClick={applyAttendanceFilters}>
                      Buscar
                    </button>
                    <button className="secondary" onClick={clearAttendanceFilters}>
                      Limpar filtros
                    </button>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="attendance-table-wrap">
                  <div className="attendance-table">
                    <div className="attendance-row header">
                      <div>Acoes</div>
                      <div>Cod.</div>
                      <div>Agente</div>
                      <div>Contato</div>
                      <div>Numero de protocolo</div>
                      <div>Entrada</div>
                      <div>Termino</div>
                      <div>Status</div>
                      <div>Tempo Atendimento</div>
                    </div>
                    {pagedAttendances.length === 0 ? (
                      <div className="empty-state">Nenhum atendimento encontrado.</div>
                    ) : (
                      pagedAttendances.map((convo) => {
                        const statusMeta = getAttendanceStatusMeta(convo.status);
                        const startedAt = convo.startedAt ? new Date(convo.startedAt) : null;
                        const endedAt = convo.closedAt
                          ? new Date(convo.closedAt)
                          : new Date(attendanceNow);
                        const hasStart = startedAt && !Number.isNaN(startedAt.getTime());
                        const hasEnd = endedAt && !Number.isNaN(endedAt.getTime());
                        const durationMs = hasStart && hasEnd ? endedAt.getTime() - startedAt.getTime() : NaN;
                        const duration = formatDuration(durationMs);
                        const agentLabel =
                          deviceLabelMap.get(convo.deviceId) ||
                          convo.deviceName ||
                          convo.deviceId ||
                          "Sem agente";
                        return (
                          <div key={convo.id} className="attendance-row">
                            <div className="attendance-actions">
                              <button className="secondary" onClick={() => openAttendanceDetails(convo.id)}>
                                Visualizar
                              </button>
                              <button
                                className="danger"
                                onClick={() => closeAttendanceById(convo.id)}
                                disabled={convo.status === "closed"}
                              >
                                Finalizar
                              </button>
                            </div>
                            <div>{formatValue(convo.id)}</div>
                            <div className="attendance-cell">
                              <div>{agentLabel}</div>
                              <span className="channel-label whatsapp">
                                <span className="channel-dot" />
                                WhatsApp
                              </span>
                            </div>
                            <div className="attendance-cell">
                              <div>{convo.name || "Sem nome"}</div>
                              <div className="attendance-sub">{formatValue(convo.phone)}</div>
                            </div>
                            <div>{formatValue(convo.protocol)}</div>
                            <div>{formatDate(convo.startedAt)}</div>
                            <div>{convo.closedAt ? formatDate(convo.closedAt) : "--"}</div>
                            <div>
                              <span className={`pill ${statusMeta.pill}`}>{statusMeta.label}</span>
                            </div>
                            <div>{duration}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                {attendancePageCount > 1 ? (
                  <div className="pagination">
                    {Array.from({ length: attendancePageCount }).map((_, index) => {
                      const page = index + 1;
                      return (
                        <button
                          key={`attendance-page-${page}`}
                          className={`page-btn ${attendancePage === page ? "active" : ""}`}
                          onClick={() => setAttendancePage(page)}
                        >
                          {page}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </>
          ) : attendanceDetails ? (
            <div className="attendance-detail">
              <div className="attendance-detail-top">
                <button className="secondary" onClick={showAttendanceList}>
                  Voltar
                </button>
                <div className="device-meta">
                  Atendimento {formatValue(attendanceDetails.protocol || attendanceDetails.id)}
                </div>
              </div>
              <div className="card attendance-header">
                <div className="attendance-header-main">
                  <div className="attendance-status-text">{attendanceStatus.header}</div>
                  <div className="attendance-header-info">
                    <span className="channel-label whatsapp">
                      <span className="channel-dot" />
                      WhatsApp
                    </span>
                    <span>Agente: {attendanceAgentLabel}</span>
                    <span>Entrada: {formatDate(attendanceDetails.startedAt)}</span>
                    <span>Situacao: {attendanceStatus.situation}</span>
                  </div>
                </div>
                <div className="attendance-header-actions">
                  <button className="danger" onClick={closeAttendanceDetails} disabled={attendanceClosed}>
                    Finalizar Chamada
                  </button>
                </div>
              </div>

              <div className="attendance-grid">
                <div className="attendance-main">
                  <div className="card">
                    <div className="card-head">
                      <h3>Cliente</h3>
                    </div>
                    <div className="attendance-fields">
                      <div className="attendance-field">
                        <span className="attendance-field-label">Nome</span>
                        <span className="attendance-field-value">
                          {formatValue(attendanceDetails.name)}
                        </span>
                      </div>
                      <div className="attendance-field">
                        <span className="attendance-field-label">Telefone</span>
                        <span className="attendance-field-value">
                          {formatValue(attendanceDetails.phone)}
                        </span>
                      </div>
                      <div className="attendance-field">
                        <span className="attendance-field-label">E-mail</span>
                        <span className="attendance-field-value">
                          {formatValue(attendanceDetails.email)}
                        </span>
                      </div>
                      <div className="attendance-field">
                        <span className="attendance-field-label">Numero de protocolo</span>
                        <span className="attendance-field-value">
                          {formatValue(attendanceDetails.protocol)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="card attendance-chat-card">
                    <div className="card-head">
                      <h3>Conversa</h3>
                    </div>
                    <div className="attendance-chat-history">
                      {sortedAttendanceMessages.length === 0 ? (
                        <div className="device-meta">Sem mensagens registradas.</div>
                      ) : (
                        sortedAttendanceMessages.map((msg) => {
                          const isOutgoing =
                            msg.direction === "out" || msg.origin === "AGENTE" || msg.origin === "BOT";
                          const isBot = msg.origin === "BOT";
                          const sender = isOutgoing
                            ? isBot
                              ? "Bot"
                              : attendanceAgentLabel
                            : attendanceDetails.name || "Cliente";
                          const avatarText = isOutgoing
                            ? isBot
                              ? "BOT"
                              : (attendanceAgentLabel || "A").trim().slice(0, 2).toUpperCase()
                            : "WA";
                          return (
                            <div
                              key={msg.id}
                              className={`attendance-message ${isOutgoing ? "out" : "in"} ${
                                isBot ? "bot" : ""
                              }`}
                            >
                              {!isOutgoing ? (
                                <div className="attendance-avatar whatsapp">{avatarText}</div>
                              ) : null}
                              <div className="attendance-bubble">
                                <div className="attendance-bubble-head">
                                  <span className="attendance-sender">{sender}</span>
                                  <span className="attendance-time">{formatDate(msg.createdAt)}</span>
                                </div>
                                <div className="attendance-text">{msg.content}</div>
                              </div>
                              {isOutgoing ? (
                                <div className={`attendance-avatar ${isBot ? "bot" : "agent"}`}>
                                  {avatarText}
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {attendanceQuickReplies.length ? (
                      <div className="attendance-quick-replies">
                        {attendanceQuickReplies.map((reply) => (
                          <button
                            key={reply.id}
                            className="quick-reply-btn"
                            onClick={() => sendAttendanceMessage(reply.response || "")}
                            disabled={attendanceClosed}
                            title={reply.response || reply.trigger || ""}
                          >
                            {reply.trigger || reply.response || "Resposta"}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="attendance-chat-input">
                      <textarea
                        className="textarea"
                        placeholder={attendanceClosed ? "Atendimento finalizado." : "Escreva uma mensagem..."}
                        value={attendanceMessage}
                        onChange={(event) => setAttendanceMessage(event.target.value)}
                        disabled={attendanceClosed}
                      />
                      <div className="attendance-input-actions">
                        <button className="primary" onClick={() => sendAttendanceMessage()} disabled={attendanceClosed}>
                          Enviar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <aside className="attendance-sidebar">
                  <div className="card attendance-side-card">
                    <div className="side-block">
                      <div className="side-block-title">Numero de protocolo</div>
                      <div className="side-row">
                        <span>{formatValue(attendanceDetails.protocol)}</span>
                        <button
                          className="copy-btn"
                          onClick={() => copyToClipboard(attendanceDetails.protocol)}
                          disabled={!attendanceDetails.protocol}
                        >
                          Copiar
                        </button>
                      </div>
                    </div>
                    <div className="side-block">
                      <div className="side-block-title">Contato</div>
                      <div className="side-row">
                        <span>{formatValue(attendanceDetails.name)}</span>
                        <button
                          className="copy-btn"
                          onClick={() => copyToClipboard(attendanceDetails.name)}
                          disabled={!attendanceDetails.name}
                        >
                          Copiar
                        </button>
                      </div>
                      <div className="side-row">
                        <span>{formatValue(attendanceDetails.phone)}</span>
                        <button
                          className="copy-btn"
                          onClick={() => copyToClipboard(attendanceDetails.phone)}
                          disabled={!attendanceDetails.phone}
                        >
                          Copiar
                        </button>
                      </div>
                    </div>
                    <div className="side-block">
                      <div className="side-block-title">Informacoes extras</div>
                      <div className="device-meta">--</div>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="empty-state">Carregando atendimento...</div>
            </div>
          )}
        </section>

        <section className={`view ${activeView === "tests" ? "active" : ""}`}>
          <div className="card">
            <div className="card-head">
              <h3>Requisicoes NEWBR</h3>
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
                <details className="flow-dropdown" open>
                  <summary className="flow-section-head">
                    <span className="flow-dot green" />
                    Acionamentos
                  </summary>
                  <div className="flow-section-body">
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
                    <div className="flow-reactivation">
                      <div className="flow-reactivation-title">Intervalo de reativacao</div>
                      <div className="flow-reactivation-row">
                        <input
                          className="input"
                          type="number"
                          min="0"
                          value={flowReactivation.value}
                          onChange={(event) =>
                            setFlowReactivation((prev) => ({
                              ...prev,
                              value: Number(event.target.value)
                            }))
                          }
                        />
                        <select
                          className="select"
                          value={flowReactivation.unit}
                          onChange={(event) =>
                            setFlowReactivation((prev) => ({ ...prev, unit: event.target.value }))
                          }
                        >
                          {FLOW_REACTIVATION_UNITS.map((unit) => (
                            <option key={unit.value} value={unit.value}>
                              {unit.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="device-meta">0 = sem bloqueio</div>
                    </div>
                  </div>
                </details>

                <details className="flow-dropdown" open>
                  <summary className="flow-section-head">
                    <span className="flow-dot amber" />
                    Blocos de acoes ({FLOW_ACTIONS.length})
                  </summary>
                  <div className="flow-section-body">
                    <div className="flow-action-grid">
                      {FLOW_ACTIONS.map((action) => (
                        <div
                          key={action.type}
                          className="flow-action-card"
                          draggable
                          onDragStart={(event) => handleFlowDragStart(event, action.type)}
                        >
                          {action.label}
                        </div>
                      ))}
                    </div>
                    <div className="device-meta">Arraste um bloco para o canvas.</div>
                  </div>
                </details>

                <details className="flow-dropdown" open>
                  <summary className="flow-section-head">
                    <span className="flow-dot purple" />
                    Regras
                  </summary>
                  <div className="flow-section-body">
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
                </details>

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
                      <div className="form-row">
                        <button
                          className="secondary"
                          onClick={applyFlowStagesJson}
                          disabled={!!flowStageParsed.error}
                        >
                          Aplicar no canvas
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {flowError ? <div className="hint">{flowError}</div> : null}
                </div>
              </aside>

              <div className="flow-editor-canvas" ref={flowCanvasRef}>
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  onNodesChange={handleFlowNodesChange}
                  onEdgesChange={handleFlowEdgesChange}
                  onConnect={handleFlowConnect}
                  nodeTypes={flowNodeTypes}
                  onInit={setFlowInstance}
                  onDrop={handleFlowDrop}
                  onDragOver={handleFlowDragOver}
                  fitView
                  panOnScroll
                >
                  <Background variant="dots" gap={24} size={1} color="rgba(148, 163, 184, 0.2)" />
                  <Controls />
                  <MiniMap />
                </ReactFlow>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {flowNodeModal.open && flowNodeDraft ? (
        <div
          className="modal"
          onClick={(event) => {
            if (event.target.classList.contains("modal")) closeFlowNodeModal();
          }}
        >
          <div className="modal-card wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{FLOW_ACTION_MAP[flowNodeModal.kind]?.label || "Bloco"}</h3>
              <button className="icon" onClick={closeFlowNodeModal}>
                X
              </button>
            </div>
            <div className="modal-body flow-node-modal">
              {flowNodeModal.kind === "text" ? (
                <>
                  <textarea
                    className="textarea"
                    placeholder="Mensagem"
                    value={flowNodeDraft.message || ""}
                    onChange={(event) => updateFlowNodeDraft({ message: event.target.value })}
                  />
                  <div className="form-row">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() =>
                        updateFlowNodeDraft({
                          message: `${flowNodeDraft.message || ""} {#nome}`.trim()
                        })
                      }
                    >
                      #Tag
                    </button>
                  </div>
                  <input
                    className="input"
                    placeholder="Salvar resposta em variavel"
                    value={flowNodeDraft.saveVar || ""}
                    onChange={(event) => updateFlowNodeDraft({ saveVar: event.target.value })}
                  />
                </>
              ) : null}

              {["image", "video", "document"].includes(flowNodeModal.kind) ? (
                <>
                  <input
                    className="input"
                    type="file"
                    accept={
                      flowNodeModal.kind === "image"
                        ? "image/*"
                        : flowNodeModal.kind === "video"
                        ? "video/*"
                        : "*"
                    }
                    onChange={handleFlowFileChange}
                  />
                  {flowNodeDraft.fileName ? <div className="device-meta">{flowNodeDraft.fileName}</div> : null}
                  <input
                    className="input"
                    placeholder="Legenda"
                    value={flowNodeDraft.caption || ""}
                    onChange={(event) => updateFlowNodeDraft({ caption: event.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Salvar resposta em variavel"
                    value={flowNodeDraft.saveVar || ""}
                    onChange={(event) => updateFlowNodeDraft({ saveVar: event.target.value })}
                  />
                </>
              ) : null}

              {flowNodeModal.kind === "audio" ? (
                <>
                  <input className="input" type="file" accept="audio/*" onChange={handleFlowFileChange} />
                  {flowNodeDraft.fileName ? <div className="device-meta">{flowNodeDraft.fileName}</div> : null}
                  <div className="form-row">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() =>
                        updateFlowNodeDraft({ recording: !flowNodeDraft.recording })
                      }
                    >
                      {flowNodeDraft.recording ? "Parar gravacao" : "Gravar audio"}
                    </button>
                  </div>
                  <input
                    className="input"
                    placeholder="Salvar resposta em variavel"
                    value={flowNodeDraft.saveVar || ""}
                    onChange={(event) => updateFlowNodeDraft({ saveVar: event.target.value })}
                  />
                </>
              ) : null}

              {flowNodeModal.kind === "responses" ? (
                <>
                  <textarea
                    className="textarea"
                    placeholder="Mensagem principal"
                    value={flowNodeDraft.message || ""}
                    onChange={(event) => updateFlowNodeDraft({ message: event.target.value })}
                  />
                  <select
                    className="select"
                    value={flowNodeDraft.matchType || "includes"}
                    onChange={(event) => updateFlowNodeDraft({ matchType: event.target.value })}
                  >
                    <option value="includes">Contem</option>
                    <option value="exact">Igual</option>
                    <option value="starts_with">Comeca com</option>
                    <option value="ends_with">Termina com</option>
                  </select>
                  <div className="flow-option-list">
                    {(flowNodeDraft.options || []).map((option, index) => (
                      <div key={option.id} className="flow-option-row">
                        <input
                          className="input"
                          placeholder={`Opcao ${index + 1}`}
                          value={option.label || ""}
                          onChange={(event) => updateFlowResponseOption(option.id, event.target.value)}
                        />
                        <button
                          className="icon"
                          type="button"
                          onClick={() => removeFlowResponseOption(option.id)}
                        >
                          X
                        </button>
                      </div>
                    ))}
                    <button className="secondary" type="button" onClick={addFlowResponseOption}>
                      Adicionar opcao
                    </button>
                  </div>
                  <input
                    className="input"
                    placeholder="Salvar resposta em variavel"
                    value={flowNodeDraft.saveVar || ""}
                    onChange={(event) => updateFlowNodeDraft({ saveVar: event.target.value })}
                  />
                  <label className="flow-switch inline">
                    <span>Repetir bloco de perguntas</span>
                    <input
                      type="checkbox"
                      checked={!!flowNodeDraft.fallbackRepeat}
                      onChange={(event) => updateFlowNodeDraft({ fallbackRepeat: event.target.checked })}
                    />
                  </label>
                </>
              ) : null}

              {flowNodeModal.kind === "list" ? (
                <>
                  <input
                    className="input"
                    placeholder="Titulo (opcional)"
                    value={flowNodeDraft.title || ""}
                    onChange={(event) => updateFlowNodeDraft({ title: event.target.value })}
                  />
                  <textarea
                    className="textarea"
                    placeholder="Descricao"
                    value={flowNodeDraft.description || ""}
                    onChange={(event) => updateFlowNodeDraft({ description: event.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Rodape"
                    value={flowNodeDraft.footer || ""}
                    onChange={(event) => updateFlowNodeDraft({ footer: event.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Texto do botao"
                    value={flowNodeDraft.buttonText || ""}
                    onChange={(event) => updateFlowNodeDraft({ buttonText: event.target.value })}
                  />
                  <div className="flow-list-stats">
                    <span>Categorias: {flowNodeCategories.length}</span>
                    <span>Produtos: {flowNodeItemsCount}</span>
                  </div>
                  <div className="flow-list-categories">
                    {flowNodeCategories.map((category, index) => (
                      <div key={category.id} className="flow-category-card">
                        <div className="flow-category-head">
                          <input
                            className="input"
                            placeholder={`Categoria ${index + 1}`}
                            value={category.title || ""}
                            onChange={(event) => updateFlowListCategory(category.id, event.target.value)}
                          />
                          <button
                            className="icon"
                            type="button"
                            onClick={() => removeFlowListCategory(category.id)}
                          >
                            X
                          </button>
                        </div>
                        <div className="flow-category-items">
                          {Array.isArray(category.items) && category.items.length ? (
                            category.items.map((item) => (
                              <div key={item.id} className="flow-item-row">
                                <input
                                  className="input"
                                  placeholder="Produto"
                                  value={item.title || ""}
                                  onChange={(event) =>
                                    updateFlowListItem(category.id, item.id, "title", event.target.value)
                                  }
                                />
                                <input
                                  className="input"
                                  placeholder="Descricao"
                                  value={item.description || ""}
                                  onChange={(event) =>
                                    updateFlowListItem(
                                      category.id,
                                      item.id,
                                      "description",
                                      event.target.value
                                    )
                                  }
                                />
                                <button
                                  className="icon"
                                  type="button"
                                  onClick={() => removeFlowListItem(category.id, item.id)}
                                >
                                  X
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="device-meta">Sem produtos nesta categoria.</div>
                          )}
                        </div>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => addFlowListItem(category.id)}
                        >
                          Adicionar produto
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    onClick={addFlowListCategory}
                    disabled={flowNodeCategories.length >= 10}
                  >
                    Adicionar categoria
                  </button>
                  <input
                    className="input"
                    placeholder="Salvar resposta em variavel"
                    value={flowNodeDraft.saveVar || ""}
                    onChange={(event) => updateFlowNodeDraft({ saveVar: event.target.value })}
                  />
                  <label className="flow-switch inline">
                    <span>Repetir bloco de listas</span>
                    <input
                      type="checkbox"
                      checked={!!flowNodeDraft.fallbackRepeat}
                      onChange={(event) => updateFlowNodeDraft({ fallbackRepeat: event.target.checked })}
                    />
                  </label>
                </>
              ) : null}

              <div className="form-row">
                <button className="secondary" type="button" onClick={closeFlowNodeModal}>
                  Cancelar
                </button>
                <button className="primary" type="button" onClick={saveFlowNodeDraft}>
                  Salvar
                </button>
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
              <input
                className="input"
                placeholder="Nome do fluxo"
                value={newFlow.name}
                onChange={(event) => setNewFlow((prev) => ({ ...prev, name: event.target.value }))}
              />
              <div className="device-meta">O fluxo sera criado inativo por padrao.</div>
              <details className="flow-advanced">
                <summary>Avancado</summary>
                <div className="flow-advanced-body">
                  <div className="form-row">
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
                    <label className="flow-switch inline">
                      <span>Ativo</span>
                      <input
                        type="checkbox"
                        checked={newFlow.enabled}
                        onChange={(event) => setNewFlow((prev) => ({ ...prev, enabled: event.target.checked }))}
                      />
                    </label>
                  </div>
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
                </div>
              </details>
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
