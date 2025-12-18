import puppeteer from "puppeteer";
import { logger } from "./utils/logger.js";

const LOGIN_URL = process.env.GERENCIA_LOGIN_URL || "https://gerenciaapp.top/login";
const CREATE_URL = process.env.GERENCIA_CREATE_URL || "https://gerenciaapp.top/users/create";

const GERENCIA_USER = process.env.GERENCIA_USER || "da2298@br.com";
const GERENCIA_PASS = process.env.GERENCIA_PASS || "90012345";

const FORM_DATA = {
  macLabel: "MAC DO DISPOSITIVO",
  macValue: "AB22",
  serverNameLabel: "NOME DO SERVER",
  serverNameValue: "TESTEAUTOMOCAO",
  m3uLabel: "LISTA M3U8",
  m3uValue: "TESTEM3U",
  epgLabel: "URL EPG",
  epgValue: "",
  appLabel: "APP QUE O CLIENTE USARÁ",
  appValue: "",
  priceLabel: "VALOR DA ASSINATURA",
  priceValue: "",
  nameLabel: "NOME",
  nameValue: "",
  phoneLabel: "WHATSAPP",
  phoneValue: "",
  notesLabel: "OBSERVACOES",
  notesValue: ""
};

async function selecionarModoM3u(page) {
  const result = await page.evaluate(() => {
    const preferidas = ["M3U8", "M3U"];

    const acharSelect = () => {
      const byId = document.querySelector("#modoSelecao");
      if (byId) return byId;

      const selects = Array.from(document.querySelectorAll("select"));
      return (
        selects.find((sel) => {
          const label =
            (sel.id && document.querySelector(`label[for="${sel.id}"]`)) ||
            sel.closest("label") ||
            sel.parentElement?.querySelector("label");
          const textoLabel = (label?.textContent || "").toUpperCase();
          return textoLabel.includes("MODO") && textoLabel.includes("SELE");
        }) || null
      );
    };

    const sel = acharSelect();
    if (!sel) return { ok: false, reason: "Select 'Modo de selecao' nao encontrado" };

    const opts = Array.from(sel.options || []);
    const alvo =
      opts.find((o) => {
        const texto = (o.textContent || o.value || "").toUpperCase();
        return preferidas.some((pref) => texto.includes(pref));
      }) || null;

    if (!alvo) return { ok: false, reason: "Opcao M3U/M3U8 nao encontrada" };

    sel.value = alvo.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));

    return { ok: true, escolhido: (alvo.textContent || alvo.value || "").trim() };
  });

  if (result.ok) {
    logger.info(`Modo de selecao ajustado para: ${result.escolhido}`);
  } else {
    logger.warn(`Aviso: ${result.reason}`);
  }
}

async function dumpLabels(page) {
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("label")).map((l) => ({
      text: (l.textContent || "").trim(),
      forAttr: l.getAttribute("for") || null,
      hasInput: !!l.querySelector("input, select, textarea")
    }))
  );
  logger.info("Labels encontrados na pagina de cadastro:");
  labels
    .slice(0, 50)
    .forEach((l, idx) =>
      logger.info(`${idx + 1}. "${l.text}" for=${l.forAttr} hasInput=${l.hasInput}`)
    );
}

async function dumpInputs(page) {
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, select, textarea")).map((el, idx) => ({
      idx,
      tag: el.tagName,
      type: el.type || "",
      name: el.name || "",
      id: el.id || "",
      placeholder: el.placeholder || "",
      className: el.className || ""
    }))
  );
  logger.info("Inputs encontrados na pagina de cadastro:");
  inputs.slice(0, 50).forEach((i) =>
    logger.info(
      `${i.idx}. <${i.tag.toLowerCase()}> type=${i.type} name="${i.name}" id="${i.id}" placeholder="${i.placeholder}" class="${i.className}"`
    )
  );
}

async function fillByLabel(page, labelText, value) {
  const result = await page.evaluate(
    (labelTextArg, valueArg) => {
      const normalize = (str) =>
        (str || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toUpperCase();

      const targetNormalized = normalize(labelTextArg);
      const labels = Array.from(document.querySelectorAll("label"));
      const target = labels.find((l) =>
        normalize(l.textContent || "").includes(targetNormalized)
      );

      if (!target) return { ok: false, reason: `Label "${labelTextArg}" not found` };

      const findControl = (labelEl) => {
        // 1) for/id
        const forAttr = labelEl.getAttribute("for");
        if (forAttr) {
          const byId = document.getElementById(forAttr);
          if (byId) return byId;
        }
        // 2) inside same parent
        const parent = labelEl.parentElement;
        if (parent) {
          const inside = parent.querySelector("input, select, textarea");
          if (inside && inside !== labelEl) return inside;
        }
        // 3) next sibling
        let sib = labelEl.nextElementSibling;
        while (sib) {
          if (sib.matches("input, select, textarea")) return sib;
          const nested = sib.querySelector && sib.querySelector("input, select, textarea");
          if (nested) return nested;
          sib = sib.nextElementSibling;
        }
        // 4) first input/select/textarea after label in DOM order
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_ELEMENT,
          {
            acceptNode(node) {
              if (node.matches && node.matches("input, select, textarea")) return NodeFilter.FILTER_ACCEPT;
              return NodeFilter.FILTER_SKIP;
            }
          }
        );
        let found = null;
        let started = false;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node === labelEl) {
            started = true;
            continue;
          }
          if (started && node.matches && node.matches("input, select, textarea")) {
            found = node;
            break;
          }
        }
        return found;
      };

      const control = findControl(target);
      if (!control) return { ok: false, reason: `Input for "${labelTextArg}" not found` };

      const tag = (control.tagName || "").toLowerCase();
      if (tag === "select") {
        const options = Array.from(control.options || []);
        const match = options.find(
          (o) =>
            (o.textContent || "").toUpperCase().includes(valueArg.toUpperCase()) ||
            (o.value || "").toUpperCase() === valueArg.toUpperCase()
        );
        if (match) {
          control.value = match.value;
          control.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          return { ok: false, reason: `Option "${valueArg}" not found for "${labelTextArg}"` };
        }
      } else {
        control.value = "";
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.value = valueArg;
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }

      return { ok: true };
    },
    labelText,
    value
  );

  if (!result.ok) {
    throw new Error(result.reason);
  }
}

async function clickSubmit(page) {
  const submitClicked = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll(
        'button[type="submit"], input[type="submit"], button, input[type="button"]'
      )
    );

    const target = candidates.find((el) => {
      const text = (el.textContent || el.value || "").toUpperCase();
      return text.includes("ENVIAR") || text.includes("SALVAR") || text.includes("CRIAR");
    });

    if (target) {
      target.click();
      return true;
    }
    return false;
  });

  if (!submitClicked) {
    await page.click('button[type="submit"]');
  }
}

export async function criarUsuarioGerenciaApp() {
  return criarUsuarioGerenciaAppComM3u(FORM_DATA.m3uValue);
}

export async function criarUsuarioGerenciaAppComM3u(m3uValue, options = {}) {
  const minimalFields = !!options.minimalFields;
  const mac = minimalFields ? options.mac : options.mac ?? FORM_DATA.macValue;
  const serverName = minimalFields ? options.serverName : options.serverName ?? FORM_DATA.serverNameValue;
  const epg = minimalFields ? options.epg : options.epg ?? FORM_DATA.epgValue;
  const app = minimalFields ? options.app : options.app ?? FORM_DATA.appValue;
  const price = minimalFields ? options.price : options.price ?? FORM_DATA.priceValue;
  const nome = minimalFields ? options.nome : options.nome ?? FORM_DATA.nameValue;
  const whatsapp = minimalFields ? options.whatsapp : options.whatsapp ?? FORM_DATA.phoneValue;
  const observacoes = minimalFields ? options.observacoes : options.observacoes ?? FORM_DATA.notesValue;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
    const page = await browser.newPage();

  try {
    logger.info("Acessando tela de login do GerenciaApp...");
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });

    await page.type('input[type="email"], input[name="email"]', GERENCIA_USER, { delay: 20 });
    await page.type('input[type="password"], input[name="password"]', GERENCIA_PASS, { delay: 20 });

    // Tenta localizar botao de submit de forma mais flexivel, senao usa Enter
    const foundSubmit = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll('button, input[type="submit"], input[type="button"]')
      );
      const target =
        candidates.find((el) => {
          const text = (el.textContent || el.value || "").toUpperCase();
          return (
            text.includes("ENTRAR") ||
            text.includes("LOGIN") ||
            text.includes("LOGAR") ||
            text.includes("ACESSAR") ||
            text.includes("ENVIAR") ||
            el.type === "submit"
          );
        }) || candidates[0];

      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    if (!foundSubmit) {
      // fallback: pressiona Enter no campo de senha
      const passwordInput =
        (await page.$('input[type="password"], input[name="password"]')) || null;
      if (!passwordInput) throw new Error("Campo de senha nao encontrado");
      await passwordInput.press("Enter");
    }

    await page.waitForNavigation({ waitUntil: "networkidle2" });

    logger.info("Login concluido, abrindo tela de cadastro...");
    await page.goto(CREATE_URL, { waitUntil: "networkidle2" });
    logger.info("Ajustando modo de selecao para M3U8...");
    await selecionarModoM3u(page);

    try {
      if (minimalFields) {
        if (!mac || !serverName || !m3uValue) {
          throw new Error("minimalFields requer mac, serverName e m3uValue preenchidos");
        }

        if (mac) {
          await page.evaluate((value) => {
            const inp = document.querySelector("#mac-input");
            if (inp) {
              inp.value = "";
              inp.dispatchEvent(new Event("input", { bubbles: true }));
              inp.value = value;
              inp.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }, mac);
        }
        logger.info(`Preenchendo minimal: MAC=${mac} | SERVER=${serverName} | M3U=${m3uValue}`);
      }

      const camposParaPreencher = minimalFields
        ? [
            [FORM_DATA.macLabel, mac],
            [FORM_DATA.serverNameLabel, serverName],
            [FORM_DATA.m3uLabel, m3uValue]
          ]
        : [
            [FORM_DATA.macLabel, mac],
            [FORM_DATA.serverNameLabel, serverName],
            [FORM_DATA.m3uLabel, m3uValue || FORM_DATA.m3uValue],
            [FORM_DATA.epgLabel, epg],
            [FORM_DATA.appLabel, app],
            [FORM_DATA.priceLabel, price],
            [FORM_DATA.nameLabel, nome],
            [FORM_DATA.phoneLabel, whatsapp],
            [FORM_DATA.notesLabel, observacoes]
          ];

      const camposFiltrados = camposParaPreencher.filter(
        ([label, value]) => !!label && value !== undefined && value !== null
      );

      for (const [label, value] of camposFiltrados) {
        await fillByLabel(page, label, value);
      }

    } catch (err) {
      await dumpLabels(page);
      await dumpInputs(page);
      throw err;
    }

    logger.info("Campos preenchidos, enviando formulario...");
    await clickSubmit(page);
    await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {});

    logger.info("Cadastro enviado no GerenciaApp.");
  } catch (error) {
    logger.error("Erro na automacao GerenciaApp", error);
    throw error;
  } finally {
    await browser.close();
  }
}
