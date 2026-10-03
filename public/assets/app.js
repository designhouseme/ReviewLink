/**
 * Generator linku: start → firma → uwagi → e-mail z kodem → panel.
 * „Mam już link”: e-mail z kodem → panel (albo firma, gdy linku jeszcze nie ma).
 * Sesja (token z /api/verify) leży w localStorage; bez niej zmiany wymagają kodu.
 */

import { normalizeEmail, normalizeGoogleUrl, normalizeSiteUrl } from "./links.js";
import { download, qrCard, qrPng, qrSvg, slug } from "./qr.js";

const ICONS = "/assets/icons.svg";
const SESSION_KEY = "dh-opinie-sesja";
const DRAFT_KEY = "dh-opinie-szkic";
const STEPS = [
  { id: "firma", label: "Firma", icon: "store" },
  { id: "uwagi", label: "Uwagi", icon: "message" },
  { id: "email", label: "E-mail", icon: "mail" },
];
const WEEKDAYS = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "So"];
const PREVIEW_STARS = { "s-rate": 0, "s-low": 2, "s-google": 5 };

const $ = (id) => document.getElementById(id);
const icon = (name, cls = "i") => `<svg class="${cls}"><use href="${ICONS}#${name}"/></svg>`;

const state = {
  flow: "create",
  data: { name: "", google: "", feedbackMode: "email", feedbackUrl: "", marketing: false },
  email: "",
  session: null,
  link: null,
  stats: null,
  justCreated: false,
  previewScreen: "s-rate",
  turnstileKey: null,
  turnstileToken: null,
  resendAt: 0,
};

/* ---------------------------------------------------------------- */
/* Pamięć przeglądarki (może nie działać w trybie prywatnym)          */
/* ---------------------------------------------------------------- */

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/* ---------------------------------------------------------------- */
/* API                                                                */
/* ---------------------------------------------------------------- */

async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth && state.session) headers.authorization = `Bearer ${state.session.token}`;
  const response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 && auth) setSession(null);
  if (!response.ok || !result.ok) {
    const error = new Error(result.error || "Coś poszło nie tak. Spróbuj za chwilę.");
    error.field = result.field;
    throw error;
  }
  return result;
}

function setSession(session) {
  state.session = session;
  save(SESSION_KEY, session);
}

function applyLink(result) {
  state.link = result.link;
  state.stats = result.stats;
  if (result.email) state.email = result.email;
  if (state.link) {
    state.data = {
      name: state.link.name,
      google: state.link.google,
      feedbackMode: state.link.feedbackMode,
      feedbackUrl: state.link.feedbackUrl ?? "",
      marketing: state.link.marketing,
    };
    fillForms();
  }
}

/* ---------------------------------------------------------------- */
/* Ekrany                                                             */
/* ---------------------------------------------------------------- */

const SCREENS = ["start", "firma", "uwagi", "email", "panel"];

function show(id, push = true) {
  if (id === "panel" && !state.link) id = "start";
  if (id === "panel") renderPanel();
  if (id === "email") prepareEmail();
  if (id === "uwagi") $("uwagi-cta").querySelector("span:not(.cta-icon)").textContent = state.session ? "Zapisz zmiany" : "Dalej";

  for (const screenId of SCREENS) $(screenId).hidden = screenId !== id;
  renderSteps(id);
  window.scrollTo(0, 0);
  if (push) history.pushState({ screen: id }, "", id === "start" ? location.pathname : `#${id}`);

  const preview = { firma: "s-rate", uwagi: "s-low" }[id];
  if (preview) setPreviewScreen(preview);
}

window.addEventListener("popstate", (event) => show(event.state?.screen ?? "start", false));

document.addEventListener("click", (event) => {
  const go = event.target.closest("[data-go]");
  if (!go) return;
  const target = go.dataset.go;
  if (target === "login") {
    state.flow = "login";
    show("email");
  } else {
    if (target === "firma" && !state.session) state.flow = "create";
    show(target);
  }
});

/** Pasek kroków. Edycja z aktywną sesją ma tylko dwa kroki, logowanie - jeden. */
function renderSteps(current) {
  for (const holder of document.querySelectorAll("[data-steps]")) {
    if (holder.dataset.steps !== current) continue;
    const steps = state.session ? STEPS.slice(0, 2) : state.flow === "login" ? [STEPS[2]] : STEPS;
    const index = steps.findIndex((step) => step.id === current);
    const items = steps
      .map((step, i) =>
        step.id === current
          ? `<span class="pill-dark">${icon(step.icon)}${state.flow === "login" && step.id === "email" ? "Logowanie" : step.label}</span>`
          : `<button class="step-dot${i < index ? " done" : ""}" type="button" data-step="${step.id}" aria-label="${step.label}"${i > index ? " disabled" : ""}>${icon(i < index ? "check" : step.icon)}</button>`,
      )
      .join("");
    holder.innerHTML = `
      <button class="icon-btn" type="button" data-back aria-label="Wstecz">${icon("arrow-left")}</button>
      <nav class="steps" aria-label="Kroki">${items}</nav>
      <button class="icon-btn preview-btn" type="button" data-open-preview aria-label="Zobacz, co zobaczy klient">${icon("eye")}</button>`;
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-back]")) {
    const current = SCREENS.find((id) => !$(id).hidden);
    const back = {
      firma: state.link ? "panel" : "start",
      uwagi: "firma",
      email: state.flow === "login" ? "start" : "uwagi",
    }[current];
    show(back ?? "start");
  }
  const step = event.target.closest("[data-step]");
  if (step && !step.disabled) show(step.dataset.step);
  if (event.target.closest("[data-open-preview]")) openPreview();
});

/* ---------------------------------------------------------------- */
/* Krok 1: firma                                                      */
/* ---------------------------------------------------------------- */

const nameInput = $("f-name");
const googleInput = $("f-google");

function fillForms() {
  nameInput.value = state.data.name;
  googleInput.value = state.data.google;
  for (const radio of document.querySelectorAll("[name=feedbackMode]")) radio.checked = radio.value === state.data.feedbackMode;
  $("f-site").value = state.data.feedbackUrl;
  $("site-field").hidden = state.data.feedbackMode !== "url";
  $("f-marketing").checked = state.data.marketing;
  updateGoogleHint();
  updateMiniPreview();
  postPreview();
}

function saveDraft() {
  if (!state.link) save(DRAFT_KEY, state.data);
}

nameInput.addEventListener("input", () => {
  state.data.name = nameInput.value;
  nameInput.removeAttribute("aria-invalid");
  saveDraft();
  updateMiniPreview();
  postPreview();
});

function updateMiniPreview() {
  const name = state.data.name.trim();
  $("mini-name").textContent = name || "Twoja firma";
  $("mini-badge").textContent = name.match(/[\p{L}\p{N}]/u)?.[0].toUpperCase() ?? "·";
}

googleInput.addEventListener("input", () => {
  state.data.google = googleInput.value;
  googleInput.removeAttribute("aria-invalid");
  saveDraft();
  updateGoogleHint();
});

function updateGoogleHint() {
  const hint = $("google-hint");
  const value = googleInput.value.trim();
  const result = value ? normalizeGoogleUrl(value) : null;
  const [cls, ico, text] = !result
    ? ["", "help", "Najlepiej link z przycisku „Poproś o opinie”, bo otwiera od razu okno oceny."]
    : result.error
      ? ["is-err", "help", result.error]
      : result.kind === "review"
        ? ["is-ok", "check", "Świetnie, ten link otwiera od razu okno opinii."]
        : ["is-warn", "help", "To link do wizytówki. Zadziała, ale klient sam musi znaleźć „Napisz opinię”. Lepszy jest link z „Poproś o opinie”."];
  hint.className = `hint ${cls}`;
  hint.innerHTML = `${icon(ico)}<span>${text}</span>`;
}

$("firma-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (state.data.name.trim().length < 2) return fieldError(form, nameInput, "Podaj nazwę firmy.");
  const google = normalizeGoogleUrl(state.data.google);
  if (google.error) return fieldError(form, googleInput, google.error);
  clearError(form);
  show("uwagi");
});

/* ---------------------------------------------------------------- */
/* Krok 2: uwagi                                                      */
/* ---------------------------------------------------------------- */

$("uwagi-form").addEventListener("change", (event) => {
  if (event.target.name !== "feedbackMode") return;
  state.data.feedbackMode = event.target.value;
  $("site-field").hidden = state.data.feedbackMode !== "url";
  if (state.data.feedbackMode === "url") $("f-site").focus();
  saveDraft();
  postPreview();
});

$("f-site").addEventListener("input", (event) => {
  state.data.feedbackUrl = event.target.value;
  event.target.removeAttribute("aria-invalid");
  saveDraft();
  postPreview();
});

$("uwagi-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (state.data.feedbackMode === "url") {
    const site = normalizeSiteUrl(state.data.feedbackUrl);
    if (site.error) return fieldError(form, $("f-site"), site.error);
  }
  clearError(form);

  if (!state.session) return show("email");

  // Edycja z aktywną sesją: zapis od razu, bez kodu.
  await busy($("uwagi-cta"), async () => {
    try {
      applyLink(await api("/api/link", { method: "PUT", body: state.data, auth: true }));
      toast("Zapisane. Adres linku bez zmian.");
      show("panel");
    } catch (error) {
      if (!state.session) {
        state.flow = "create";
        return show("email");
      }
      showError(form, error.message);
    }
  });
});

/* ---------------------------------------------------------------- */
/* Krok 3: e-mail i kod                                               */
/* ---------------------------------------------------------------- */

const emailInput = $("f-email");
const codeInput = $("f-code");

function prepareEmail() {
  const login = state.flow === "login";
  $("email-title").textContent = login ? "Zaloguj się kodem" : "Potwierdź e-mail";
  $("email-sub").textContent = login
    ? "Wpisz adres, na który założono link. Wyślemy na niego jednorazowy kod."
    : state.data.feedbackMode === "email"
      ? "Na ten adres przyjdą uwagi od klientów i Twój link. Hasła nie ma, za każdym razem wyślemy kod."
      : "Na ten adres wyślemy Twój link. Hasła nie ma, przy zmianach wyślemy kod.";
  $("marketing-row").hidden = login;
  if (!emailInput.value && state.email) emailInput.value = state.email;
  setCodePhase(false);
  mountTurnstile();
}

function setCodePhase(entering) {
  $("code-ask").hidden = entering;
  $("code-enter").hidden = !entering;
  $("email-cta-label").textContent = entering ? "Potwierdź" : "Wyślij kod";
  $("email-cta").querySelector(".cta-icon").innerHTML = icon(entering ? "key" : "mail");
  clearError($("email-form"));
  if (entering) {
    codeInput.value = "";
    renderOtp();
    setTimeout(() => codeInput.focus(), 50);
  }
}

$("email-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if ($("code-enter").hidden) sendCode();
  else verifyCode();
});

async function sendCode() {
  const form = $("email-form");
  const email = normalizeEmail(emailInput.value);
  if (!email) return fieldError(form, emailInput, "Podaj poprawny adres e-mail.");
  if (state.turnstileKey && !state.turnstileToken) return showError(form, "Poczekaj chwilę na sprawdzenie, czy nie jesteś robotem.");
  state.email = email;
  state.data.marketing = $("f-marketing").checked;

  await busy($("email-cta"), async () => {
    try {
      const result = await api("/api/code", { method: "POST", body: { email, turnstile: state.turnstileToken } });
      $("code-email").textContent = email;
      $("dev-code").hidden = !result.devCode;
      if (result.devCode) $("dev-code").innerHTML = `Tryb lokalny, kod: <b>${result.devCode}</b>`;
      setCodePhase(true);
      startResendTimer();
    } catch (error) {
      showError(form, error.message);
      window.turnstile?.reset?.();
      state.turnstileToken = null;
    }
  });
}

async function verifyCode() {
  const form = $("email-form");
  const code = codeInput.value.replace(/\D/g, "");
  if (code.length !== 6) return showError(form, "Wpisz 6 cyfr z maila.");

  await busy($("email-cta"), async () => {
    try {
      const result = await api("/api/verify", { method: "POST", body: { email: state.email, code } });
      setSession({ token: result.token, expiresAt: result.expiresAt });

      if (state.flow === "login") {
        applyLink(result);
        if (state.link) return show("panel");
        toast("Nie masz jeszcze linku. Zróbmy go.");
        state.flow = "create";
        return show("firma");
      }

      const saved = await api("/api/link", { method: "PUT", body: state.data, auth: true });
      applyLink(saved);
      state.justCreated = saved.created;
      save(DRAFT_KEY, null);
      show("panel");
    } catch (error) {
      $("code-enter").querySelector(".otp").classList.add("is-err");
      showError(form, error.message);
    }
  });
}

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
  $("code-enter").querySelector(".otp").classList.remove("is-err");
  renderOtp();
  if (codeInput.value.length === 6) verifyCode();
});
codeInput.addEventListener("focus", renderOtp);
codeInput.addEventListener("blur", renderOtp);

function renderOtp() {
  const digits = codeInput.value;
  document.querySelectorAll(".otp-boxes i").forEach((box, i) => {
    box.textContent = digits[i] ?? "";
    box.classList.toggle("filled", Boolean(digits[i]));
    box.classList.toggle("next", i === Math.min(digits.length, 5));
  });
}

$("change-email").addEventListener("click", () => {
  setCodePhase(false);
  emailInput.focus();
});

$("resend").addEventListener("click", sendCode);

function startResendTimer() {
  state.resendAt = Date.now() + 30_000;
  const button = $("resend");
  const tick = () => {
    const left = Math.ceil((state.resendAt - Date.now()) / 1000);
    button.disabled = left > 0;
    button.textContent = left > 0 ? `Wyślij ponownie (${left} s)` : "Wyślij ponownie";
    if (left > 0) setTimeout(tick, 500);
  };
  tick();
}

function mountTurnstile() {
  if (!state.turnstileKey || document.querySelector("script[data-turnstile]")) return;
  window.onTurnstileLoad = () =>
    window.turnstile.render("#turnstile", {
      sitekey: state.turnstileKey,
      appearance: "interaction-only",
      callback: (token) => (state.turnstileToken = token),
    });
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
  script.async = true;
  script.dataset.turnstile = "";
  document.head.append(script);
}

/* ---------------------------------------------------------------- */
/* Panel                                                              */
/* ---------------------------------------------------------------- */

function renderPanel() {
  const { link, stats } = state;
  $("panel-title").textContent = state.justCreated ? "Gotowe!" : "Twój link";
  $("panel-kicker").textContent = state.justCreated ? "Link działa od teraz" : state.email;
  $("panel-name").textContent = link.name;
  $("panel-url").textContent = link.url.replace(/^https?:\/\//, "");
  $("panel-url").href = link.url;
  $("open-link").href = link.url;
  $("qr-preview").innerHTML = qrSvg(link.url, 2);

  const savedMessage = load(`dh-opinie-wiadomosc-${link.id}`);
  $("msg-text").value =
    savedMessage ?? `Dzień dobry! Dziękujemy za zlecenie. Będziemy wdzięczni za krótką ocenę naszej pracy, to zajmie 10 sekund: ${link.url}\n${link.name}`;
  requestAnimationFrame(fitMessage);

  const week = stats?.week ?? [];
  const sum = (key) => week.reduce((total, day) => total + (day[key] ?? 0), 0);
  $("st-views").textContent = sum("views");
  $("st-google").textContent = sum("google");
  $("st-feedback").textContent = sum("feedback");
  $("stats-note").textContent = stats?.views ? `Od początku: ${stats.views} wejść` : "Jeszcze nikt nie kliknął. Wyślij link pierwszemu klientowi.";

  const max = Math.max(1, ...week.map((day) => day.good + day.bad));
  const today = new Date().getDay();
  $("bars").innerHTML = Array.from({ length: 7 }, (_, i) => {
    const ago = 6 - i;
    const day = week[ago] ?? { good: 0, bad: 0 };
    const height = (n) => (n ? Math.max(10, Math.round((n / max) * 88)) : 0);
    const bars = day.good + day.bad === 0
      ? `<i class="none"></i>`
      : `${day.bad ? `<i class="bad" style="height:${height(day.bad)}px"></i>` : ""}${day.good ? `<i class="good" style="height:${height(day.good)}px"></i>` : ""}`;
    return `<div class="bar-day">${bars}<span>${WEEKDAYS[(today - ago + 7) % 7]}</span></div>`;
  }).join("");
}

$("msg-text").addEventListener("input", (event) => {
  if (state.link) save(`dh-opinie-wiadomosc-${state.link.id}`, event.target.value);
  fitMessage();
});

function fitMessage() {
  const area = $("msg-text");
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight + 2}px`;
}

$("copy-link").addEventListener("click", () => copy(state.link.url, "Link skopiowany"));
$("copy-msg").addEventListener("click", () => copy($("msg-text").value, "Wiadomość skopiowana"));
$("share-link").addEventListener("click", async () => {
  if (navigator.share) {
    try {
      await navigator.share({ title: state.link.name, text: $("msg-text").value });
    } catch {}
  } else {
    copy($("msg-text").value, "Wiadomość skopiowana");
  }
});

document.querySelectorAll("[data-qr]").forEach((button) =>
  button.addEventListener("click", async () => {
    const { url, name } = state.link;
    const file = `opinie-${slug(name)}`;
    button.disabled = true;
    try {
      if (button.dataset.qr === "svg") download(new Blob([qrSvg(url)], { type: "image/svg+xml" }), `${file}-qr.svg`);
      if (button.dataset.qr === "png") download(await qrPng(url), `${file}-qr.png`);
      if (button.dataset.qr === "karta") download(await qrCard({ url, name }), `${file}-karta-a6.png`);
      toast("Pobrano");
    } finally {
      button.disabled = false;
    }
  }),
);

$("logout").addEventListener("click", () => {
  setSession(null);
  state.link = null;
  state.stats = null;
  state.flow = "create";
  state.data = { name: "", google: "", feedbackMode: "email", feedbackUrl: "", marketing: false };
  fillForms();
  toast("Wylogowano");
  show("start");
});

/* ---------------------------------------------------------------- */
/* Podgląd                                                            */
/* ---------------------------------------------------------------- */

const frame = $("preview");

function postPreview(withScreen = false) {
  const site = state.data.feedbackMode === "url" ? normalizeSiteUrl(state.data.feedbackUrl) : null;
  frame.contentWindow?.postMessage(
    {
      type: "dh-preview",
      cfg: {
        name: state.data.name.trim() || "Twoja firma",
        google: "#",
        site: state.data.feedbackMode === "url" ? (site?.url ? { url: site.url, host: site.host } : { url: "#", host: "twojafirma.pl" }) : null,
      },
      ...(withScreen ? { screen: state.previewScreen, stars: PREVIEW_STARS[state.previewScreen] } : {}),
    },
    location.origin,
  );
}

function setPreviewScreen(screen) {
  state.previewScreen = screen;
  for (const tab of document.querySelectorAll("[data-preview]")) tab.setAttribute("aria-selected", String(tab.dataset.preview === screen));
  postPreview(true);
}

document.querySelectorAll("[data-preview]").forEach((tab) => tab.addEventListener("click", () => setPreviewScreen(tab.dataset.preview)));

window.addEventListener("message", (event) => {
  if (event.origin === location.origin && event.data?.type === "dh-preview-ready") postPreview(true);
});

function fitPhone() {
  const stage = $("stage");
  if (!stage.offsetParent && !stage.classList.contains("open")) return;
  const top = stage.querySelector(".stage-top").offsetHeight;
  const tabs = stage.querySelector(".stage-tabs").offsetHeight;
  const style = getComputedStyle(stage);
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const gap = parseFloat(style.rowGap) * 2;
  const scale = Math.min(0.9, (stage.clientHeight - top - tabs - padding - gap) / 866, (stage.clientWidth - 32) / 412);
  $("phone-wrap").style.setProperty("--s", String(Math.max(0.3, scale)));
}

function openPreview() {
  $("stage").classList.add("open");
  document.body.style.overflow = "hidden";
  fitPhone();
}

function closePreview() {
  $("stage").classList.remove("open");
  document.body.style.overflow = "";
}

$("stage-close").addEventListener("click", closePreview);
document.addEventListener("keydown", (event) => event.key === "Escape" && closePreview());
window.addEventListener("resize", fitPhone);

/* ---------------------------------------------------------------- */
/* Drobiazgi                                                          */
/* ---------------------------------------------------------------- */

function fieldError(form, input, message) {
  input.setAttribute("aria-invalid", "true");
  input.focus();
  showError(form, message);
}

function showError(form, message) {
  const box = form.querySelector("[data-error]");
  box.innerHTML = `${icon("help")}<span>${message}</span>`;
  box.hidden = false;
}

function clearError(form) {
  const box = form.querySelector("[data-error]");
  if (box) box.hidden = true;
}

async function busy(button, task) {
  const iconBox = button.querySelector(".cta-icon");
  const before = iconBox.innerHTML;
  button.classList.add("is-busy");
  iconBox.innerHTML = icon("sparkle");
  try {
    await task();
  } finally {
    button.classList.remove("is-busy");
    iconBox.innerHTML = before;
  }
}

let toastTimer;
function toast(message) {
  const box = $("toast");
  box.innerHTML = `${icon("check")}${message}`;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), 2400);
}

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(message);
}

/* ---------------------------------------------------------------- */
/* Start                                                              */
/* ---------------------------------------------------------------- */

async function init() {
  const draft = load(DRAFT_KEY);
  if (draft) state.data = { ...state.data, ...draft };
  fillForms();

  api("/api/config")
    .then((config) => (state.turnstileKey = config.turnstile))
    .catch(() => {});

  const session = load(SESSION_KEY);
  if (session?.token && session.expiresAt > Date.now()) {
    state.session = session;
    try {
      applyLink(await api("/api/link", { auth: true }));
    } catch {}
  }

  const wanted = location.hash.slice(1);
  const first = state.link ? "panel" : ["firma", "uwagi"].includes(wanted) ? wanted : "start";
  history.replaceState({ screen: first }, "", first === "start" ? location.pathname : `#${first}`);
  show(first, false);
  fitPhone();
}

init();
