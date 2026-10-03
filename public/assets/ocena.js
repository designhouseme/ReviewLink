/**
 * Strona oceny. 4-5 gwiazdek: przycisk do Google (nowa karta) i podziękowanie.
 * 1-3: pole na uwagi wysyłane mailem do firmy albo przejście na stronę firmy,
 * plus mniejszy link do publicznej opinii w Google (regulamin Google).
 *
 * `?podglad=1` - tryb podglądu w generatorze: dane przychodzą przez
 * postMessage, nic nie jest wysyłane ani liczone.
 */

const LABELS = ["Dotknij gwiazdki", "Źle", "Słabo", "Średnio", "Dobrze", "Rewelacja"];
const TICKS = 41;
const ICONS = "/assets/icons.svg";

const preview = new URLSearchParams(location.search).has("podglad");
const $ = (id) => document.getElementById(id);
const icon = (name, cls = "i") => `<svg class="${cls}"><use href="${ICONS}#${name}"/></svg>`;

let cfg = readConfig();
let stars = 0;
let turnstileToken = null;

/* ---------------------------------------------------------------- */
/* Budowa gwiazdek i linijki                                          */
/* ---------------------------------------------------------------- */

const starsBox = $("stars");
for (let n = 1; n <= 5; n++) {
  const label = document.createElement("label");
  label.className = "star";
  label.dataset.n = n;
  label.innerHTML = `<input type="radio" name="stars" value="${n}" />${icon("star")}<span class="sr">${n} z 5, ${LABELS[n]}</span>`;
  starsBox.append(label);
}
starsBox.addEventListener("change", (event) => setStars(Number(event.target.value), true));
starsBox.addEventListener("pointerover", (event) => previewStars(Number(event.target.closest(".star")?.dataset.n ?? 0)));
starsBox.addEventListener("pointerleave", () => previewStars(0));

$("ticks").innerHTML = "<span></span>".repeat(TICKS);

function previewStars(n) {
  for (const star of starsBox.querySelectorAll(".star")) star.classList.toggle("preview", Number(star.dataset.n) <= n);
}

function setStars(n, animate) {
  stars = n;
  const card = document.querySelector(".rate-card");
  card.classList.toggle("is-empty", n === 0);
  $("score-num").textContent = String(n);
  $("score-label").textContent = LABELS[n];

  for (const star of starsBox.querySelectorAll(".star")) {
    const on = Number(star.dataset.n) <= n;
    star.classList.toggle("on", on);
    if (animate && on) {
      star.classList.remove("pop");
      void star.offsetWidth;
      star.classList.add("pop");
      setTimeout(() => star.classList.remove("pop"), 260);
    }
  }

  const lit = Math.round((n / 5) * TICKS);
  $("ticks").querySelectorAll("span").forEach((tick, i) => tick.classList.toggle("on", i < lit));
  updateRateCta();
}

/* ---------------------------------------------------------------- */
/* Główny przycisk                                                    */
/* ---------------------------------------------------------------- */

const rateCta = $("rate-cta");

function updateRateCta() {
  const toGoogle = stars >= 4 && cfg?.google;
  rateCta.setAttribute("aria-disabled", String(stars === 0));
  $("rate-cta-label").textContent = stars === 0 ? "Wybierz ocenę" : toGoogle ? "Opisz to w Google" : "Dalej";
  rateCta.querySelector(".cta-icon").innerHTML = icon(toGoogle ? "pin" : stars ? "message" : "star");
  rateCta.querySelector(".cta-arrow use").setAttribute("href", `${ICONS}#${toGoogle ? "arrow-up-right" : "chevrons"}`);

  if (toGoogle && !preview) {
    rateCta.href = cfg.google;
    rateCta.target = "_blank";
    rateCta.rel = "noopener";
    rateCta.removeAttribute("role");
  } else {
    rateCta.href = "#";
    rateCta.removeAttribute("target");
    rateCta.setAttribute("role", "button");
  }
}

rateCta.addEventListener("click", (event) => {
  if (stars === 0) {
    event.preventDefault();
    starsBox.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 260 });
    return;
  }
  track("rate", stars);

  if (stars >= 4 && cfg?.google) {
    if (preview) event.preventDefault();
    track("google");
    // Link otwiera Google w nowej karcie, a tu zostaje podziękowanie.
    setTimeout(() => show("s-google"), 60);
    return;
  }

  event.preventDefault();
  show("s-low");
});

/* ---------------------------------------------------------------- */
/* Niska ocena                                                        */
/* ---------------------------------------------------------------- */

function fillLowScreen() {
  const mini = [1, 2, 3, 4, 5].map((n) => icon("star", n <= stars ? "i on" : "i")).join("");
  $("low-chip").innerHTML = `<span class="mini">${mini}</span>${LABELS[stars] ?? ""}`;
  $("low-sub").textContent = `Wiadomość trafi prosto do ${cfg?.name ?? "firmy"}. Nie publikujemy jej nigdzie.`;

  const site = cfg?.site;
  $("note-form").hidden = Boolean(site);
  $("note-cta").hidden = Boolean(site);
  $("site-card").hidden = !site;
  $("site-cta").hidden = !site;
  $("low-title").textContent = site ? "Daj nam znać, co poprawić" : "Co możemy poprawić?";
  if (site) {
    $("site-host").textContent = site.host;
    $("site-cta").href = preview ? "#" : site.url;
    $("site-cta-label").textContent = "Przejdź na stronę";
    $("low-sub").textContent = "Zależy nam, żeby to naprawić. Napisz do nas przez formularz na naszej stronie.";
  }

  const publicLink = $("public-link");
  publicLink.hidden = !cfg?.google;
  publicLink.href = preview || !cfg?.google ? "#" : cfg.google;

  if (!site && cfg?.turnstile) mountTurnstile();
}

$("public-link").addEventListener("click", (event) => {
  if (preview) event.preventDefault();
  track("google");
});

$("site-cta").addEventListener("click", (event) => {
  if (preview) event.preventDefault();
});

$("note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const error = $("note-error");
  const button = $("note-cta");
  error.hidden = true;

  if (String(data.message ?? "").trim().length < 3) {
    $("note-text").setAttribute("aria-invalid", "true");
    $("note-text").focus();
    error.textContent = "Napisz choć kilka słów.";
    error.hidden = false;
    return;
  }
  $("note-text").removeAttribute("aria-invalid");

  if (preview) return show("s-sent");

  button.classList.add("is-busy");
  button.querySelector(".cta-icon").innerHTML = icon("sparkle");
  try {
    const response = await fetch(`/api/o/${cfg.id}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...data, stars, turnstile: turnstileToken }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Nie udało się wysłać. Spróbuj jeszcze raz.");
    form.reset();
    show("s-sent");
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    window.turnstile?.reset?.();
  } finally {
    button.classList.remove("is-busy");
    button.querySelector(".cta-icon").innerHTML = icon("send");
  }
});

/* ---------------------------------------------------------------- */
/* Ekrany i historia (przycisk Wstecz w telefonie wraca do gwiazdek)  */
/* ---------------------------------------------------------------- */

function show(id, push = true) {
  if (id === "s-low") fillLowScreen();
  if (id === "s-google") {
    const n = stars || 5;
    $("google-sub").textContent = `Google otworzył się w nowej karcie. Zaznacz tam ${n} ${n === 5 ? "gwiazdek" : "gwiazdki"} i dodaj zdanie od siebie, to bardzo pomaga.`;
    $("google-again").href = preview || !cfg?.google ? "#" : cfg.google;
  }

  for (const screen of document.querySelectorAll(".screen")) screen.hidden = screen.id !== id;
  window.scrollTo(0, 0);
  if (push && !preview) history.pushState({ screen: id }, "");
}

window.addEventListener("popstate", (event) => show(event.state?.screen ?? "s-rate", false));
document.querySelectorAll("[data-back]").forEach((button) =>
  button.addEventListener("click", () => (preview || !history.state ? show("s-rate", false) : history.back())),
);
$("google-again").addEventListener("click", (event) => {
  if (preview) event.preventDefault();
});

/* ---------------------------------------------------------------- */
/* Dane linku                                                         */
/* ---------------------------------------------------------------- */

function readConfig() {
  try {
    return JSON.parse($("cfg").textContent || "null");
  } catch {
    return null;
  }
}

function initials(name) {
  const first = String(name ?? "").match(/[\p{L}\p{N}]/u);
  return first ? first[0].toUpperCase() : "·";
}

function apply() {
  if (!cfg || cfg.missing) {
    if (!preview) show("s-missing", false);
    return;
  }
  for (const el of document.querySelectorAll("[data-company]")) el.textContent = cfg.name;
  $("badge").textContent = initials(cfg.name);
  updateRateCta();
  if (!$("s-low").hidden) fillLowScreen();
}

function track(kind, value) {
  if (preview || !cfg?.id) return;
  fetch(`/api/o/${cfg.id}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, stars: value }),
    keepalive: true,
  }).catch(() => {});
}

function mountTurnstile() {
  if (document.querySelector("#turnstile iframe") || document.querySelector("script[data-turnstile]")) return;
  window.onTurnstileLoad = () =>
    window.turnstile.render("#turnstile", {
      sitekey: cfg.turnstile,
      appearance: "interaction-only",
      callback: (token) => (turnstileToken = token),
    });
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
  script.async = true;
  script.dataset.turnstile = "";
  document.head.append(script);
}

if (preview) {
  document.documentElement.classList.add("podglad");
  cfg = { id: null, name: "Twoja firma", google: "#", site: null };
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.data?.type !== "dh-preview") return;
    cfg = { ...cfg, ...event.data.cfg, id: null };
    if (event.data.screen) {
      stars = event.data.stars ?? stars;
      setStars(stars, false);
      show(event.data.screen, false);
    }
    apply();
  });
  parent.postMessage({ type: "dh-preview-ready" }, location.origin);
}

setStars(0, false);
apply();

if (cfg?.id && !preview) {
  // Odświeżenie strony nie nabija wejść.
  let seen = false;
  try {
    seen = sessionStorage.getItem(`dh-view-${cfg.id}`) === "1";
    sessionStorage.setItem(`dh-view-${cfg.id}`, "1");
  } catch {}
  if (!seen) track("view");
  history.replaceState({ screen: "s-rate" }, "");
}
