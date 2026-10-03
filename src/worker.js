/**
 * Worker Linku do opinii. Statyczne pliki idą prosto z `public/`, ten kod
 * obsługuje tylko `/api/*` i strony oceny `/o/:id` (patrz `run_worker_first`).
 *
 * Konta nie ma: firma potwierdza adres e-mail jednorazowym kodem i dostaje
 * sesję. Jeden adres = jeden stały link; edycja zmienia dane, adres zostaje.
 *
 * Strona oceny: 4-5 gwiazdek prowadzi do Google, 1-3 pokazuje pole na uwagi,
 * które wysyłamy mailem firmie i nie zapisujemy. Link do Google przy niskiej
 * ocenie też jest (mniejszy), bo regulamin Google zabrania ukrywania go przed
 * niezadowolonymi klientami.
 */

import { normalizeEmail, normalizeGoogleUrl, normalizeSiteUrl } from "../public/assets/links.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CODE_TTL = 15 * MINUTE;
const CODE_ATTEMPTS = 5;
const SESSION_TTL = 7 * DAY;
const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const RATING_LABELS = ["", "Źle", "Słabo", "Średnio", "Dobrze", "Rewelacja"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      const review = pathname.match(/^\/o\/([A-Za-z0-9]{3,20})\/?$/);
      if (review && request.method === "GET") return reviewPage(request, env, review[1].toLowerCase());

      if (pathname.startsWith("/api/")) {
        if (request.method === "POST" || request.method === "PUT") {
          const origin = request.headers.get("origin");
          if (origin && safeHost(origin) !== url.hostname) return json({ ok: false, error: "Niedozwolone źródło." }, 403);
        }

        if (pathname === "/api/config") return json({ ok: true, turnstile: env.TURNSTILE_SITE_KEY || null });
        if (pathname === "/api/code") return sendCode(request, env);
        if (pathname === "/api/verify") return verifyCode(request, env);
        if (pathname === "/api/link") return request.method === "PUT" ? saveLink(request, env, ctx) : getLink(request, env);

        const event = pathname.match(/^\/api\/o\/([a-z0-9]{3,20})\/(event|feedback)$/);
        if (event && event[2] === "event") return recordEvent(request, env, event[1]);
        if (event && event[2] === "feedback") return sendFeedback(request, env, event[1]);

        return json({ ok: false, error: "Nie ma takiego adresu." }, 404);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("worker:", error);
      return json({ ok: false, error: "Coś poszło nie tak. Spróbuj za chwilę." }, 500);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Strona oceny                                                         */
/* ------------------------------------------------------------------ */

async function reviewPage(request, env, id) {
  const link = await env.DB.prepare("SELECT id, name, google_url, feedback_url FROM links WHERE id = ? AND disabled = 0")
    .bind(id)
    .first();

  const template = await env.ASSETS.fetch(new Request(new URL("/ocena", request.url)));
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "strict-origin-when-cross-origin",
  });

  if (!link) {
    return new HTMLRewriter()
      .on("script#cfg", { element: (el) => el.setInnerContent(scriptJson({ missing: true }), { html: true }) })
      .transform(new Response(template.body, { status: 404, headers }));
  }

  // Ponowna walidacja przy wyświetleniu: na stronie nie pojawi się nic spoza Google.
  const google = normalizeGoogleUrl(link.google_url);
  const site = link.feedback_url ? normalizeSiteUrl(link.feedback_url) : null;
  const cfg = {
    id: link.id,
    name: link.name,
    google: google.url ?? null,
    site: site?.url ? { url: site.url, host: site.host } : null,
    turnstile: env.TURNSTILE_SITE_KEY || null,
  };

  const origin = publicOrigin(request, env);
  return new HTMLRewriter()
    .on("title", { element: (el) => el.setInnerContent(`Oceń: ${link.name}`) })
    .on('meta[property="og:title"]', { element: (el) => el.setAttribute("content", `Oceń: ${link.name}`) })
    .on('meta[property="og:description"]', {
      element: (el) => el.setAttribute("content", `Jak oceniasz pracę ${link.name}? To zajmie 10 sekund.`),
    })
    .on('meta[property="og:image"]', { element: (el) => el.setAttribute("content", `${origin}/og-ocena.png`) })
    .on("[data-company]", { element: (el) => el.setInnerContent(link.name) })
    .on("script#cfg", { element: (el) => el.setInnerContent(scriptJson(cfg), { html: true }) })
    .transform(new Response(template.body, { status: 200, headers }));
}

async function recordEvent(request, env, id) {
  if (request.method !== "POST") return json({ ok: false, error: "Tylko POST." }, 405);
  const input = await readJson(request);
  const kind = ["view", "rate", "google"].includes(input?.kind) ? input.kind : null;
  if (!kind) return json({ ok: false, error: "Nieznane zdarzenie." }, 422);
  const stars = kind === "rate" ? toStars(input.stars) : null;
  if (kind === "rate" && !stars) return json({ ok: false, error: "Ocena 1-5." }, 422);

  const link = await env.DB.prepare("SELECT id FROM links WHERE id = ? AND disabled = 0").bind(id).first();
  if (!link) return json({ ok: false }, 404);

  // Statystyki to nie licznik do nabijania: ponad 20 zdarzeń na godzinę z jednego IP ignorujemy.
  const ip = await ipHash(request, env);
  const recent = await countSince(env, "SELECT COUNT(*) AS n FROM events WHERE ip_hash = ? AND link_id = ? AND created_at > ?", ip, id, Date.now() - HOUR);
  if (recent < 20) {
    await env.DB.prepare("INSERT INTO events (link_id, kind, stars, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, kind, stars, ip, Date.now())
      .run();
  }
  return json({ ok: true });
}

async function sendFeedback(request, env, id) {
  if (request.method !== "POST") return json({ ok: false, error: "Tylko POST." }, 405);
  const input = await readJson(request);
  if (!input) return json({ ok: false, error: "Nieprawidłowe dane." }, 400);

  // Pułapka na boty: pole niewidoczne dla ludzi. Wypełnione = udajemy sukces.
  if (clean(input.website, 200)) return json({ ok: true });

  const link = await env.DB.prepare("SELECT id, email, name, feedback_url FROM links WHERE id = ? AND disabled = 0").bind(id).first();
  if (!link) return json({ ok: false, error: "Ten link już nie działa." }, 404);
  if (link.feedback_url) return json({ ok: false, error: "Ta firma zbiera uwagi na swojej stronie." }, 409);

  const stars = toStars(input.stars);
  const message = clean(input.message, 4000);
  const name = clean(input.name, 120);
  const contact = clean(input.contact, 160);
  if (message.length < 3) return json({ ok: false, error: "Napisz choć kilka słów." }, 422);

  if (!(await turnstileOk(env, input.turnstile, request))) return json({ ok: false, error: "Potwierdź, że nie jesteś robotem." }, 403);

  const ip = await ipHash(request, env);
  const now = Date.now();
  const fromIp = await countSince(env, "SELECT COUNT(*) AS n FROM events WHERE kind = 'feedback' AND ip_hash = ? AND link_id = ? AND created_at > ?", ip, id, now - HOUR);
  const perDay = await countSince(env, "SELECT COUNT(*) AS n FROM events WHERE kind = 'feedback' AND link_id = ? AND created_at > ?", id, now - DAY);
  if (fromIp >= 3 || perDay >= 40) return json({ ok: false, error: "Wysłano już kilka wiadomości. Spróbuj później." }, 429);

  const replyTo = normalizeEmail(contact);
  const starsLine = stars ? `${"★".repeat(stars)}${"☆".repeat(5 - stars)}  ${stars}/5 · ${RATING_LABELS[stars]}` : "bez oceny";
  const text = [
    `Ocena: ${starsLine}`,
    "",
    message,
    "",
    "-",
    name ? `Klient: ${name}` : "Klient nie podał imienia.",
    contact ? `Kontakt: ${contact}` : "Klient nie zostawił kontaktu.",
    replyTo ? "Odpowiedz na tego maila, a wiadomość trafi prosto do klienta." : "",
    "",
    "Tej wiadomości nie publikujemy - widzisz ją tylko Ty.",
    `Chcesz, żeby link do opinii szedł sam po każdym zleceniu? ${env.CONTACT_URL}`,
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");

  try {
    await sendMail(env, {
      to: link.email,
      replyTo: replyTo || undefined,
      subject: `Uwagi od klienta${stars ? ` (${stars}/5)` : ""}${name ? ` · ${name}` : ""}`,
      text,
    });
  } catch (error) {
    console.error("mail z uwagami:", error);
    return json({ ok: false, error: "Nie udało się wysłać wiadomości. Spróbuj za chwilę." }, 502);
  }

  await env.DB.prepare("INSERT INTO events (link_id, kind, stars, ip_hash, created_at) VALUES (?, 'feedback', ?, ?, ?)")
    .bind(id, stars, ip, now)
    .run();

  return json({ ok: true });
}

/* ------------------------------------------------------------------ */
/* Kod z maila i sesja                                                  */
/* ------------------------------------------------------------------ */

async function sendCode(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Tylko POST." }, 405);
  const input = await readJson(request);
  const email = normalizeEmail(input?.email);
  if (!email) return json({ ok: false, error: "Podaj poprawny adres e-mail." }, 422);

  if (!(await turnstileOk(env, input.turnstile, request))) return json({ ok: false, error: "Potwierdź, że nie jesteś robotem." }, 403);

  // Wysyłka kodu to wciąż mail na dowolny wpisany adres - limity chronią
  // cudze skrzynki przed zasypaniem kodami.
  const ip = await ipHash(request, env);
  const now = Date.now();
  const perEmail = await countSince(env, "SELECT COUNT(*) AS n FROM codes WHERE email = ? AND created_at > ?", email, now - HOUR);
  const perIp = await countSince(env, "SELECT COUNT(*) AS n FROM codes WHERE ip_hash = ? AND created_at > ?", ip, now - HOUR);
  if (perEmail >= 3 || perIp >= 10) return json({ ok: false, error: "Wysłaliśmy już kilka kodów. Sprawdź skrzynkę albo spróbuj za godzinę." }, 429);

  const code = randomDigits(6);
  await env.DB.prepare("INSERT INTO codes (email, code_hash, ip_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)")
    .bind(email, await codeHash(env, email, code), ip, now + CODE_TTL, now)
    .run();

  try {
    await sendMail(env, {
      to: email,
      subject: `Twój kod: ${code}`,
      text: [
        `Kod do Linku do opinii: ${code}`,
        "",
        "Wpisz go na stronie, na której go zamówiłeś. Jest ważny 15 minut.",
        "Jeśli to nie Ty prosiłeś o kod, zignoruj tę wiadomość.",
      ].join("\n"),
    });
  } catch (error) {
    console.error("mail z kodem:", error);
    return json({ ok: false, error: "Nie udało się wysłać maila. Sprawdź adres albo spróbuj za chwilę." }, 502);
  }

  // Lokalnie (DEV_SHOW_CODE=1 w .dev.vars) kod wraca też w odpowiedzi.
  return json({ ok: true, ...(env.DEV_SHOW_CODE === "1" ? { devCode: code } : {}) });
}

async function verifyCode(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Tylko POST." }, 405);
  const input = await readJson(request);
  const email = normalizeEmail(input?.email);
  const code = String(input?.code ?? "").replace(/\D/g, "");
  if (!email || code.length !== 6) return json({ ok: false, error: "Wpisz 6 cyfr z maila." }, 422);

  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT rowid, code_hash, attempts FROM codes WHERE email = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(email, now)
    .first();
  if (!row) return json({ ok: false, error: "Kod wygasł. Wyślij nowy." }, 410);
  if (row.attempts >= CODE_ATTEMPTS) return json({ ok: false, error: "Za dużo prób. Wyślij nowy kod." }, 429);

  if (!timingSafeEqual(row.code_hash, await codeHash(env, email, code))) {
    await env.DB.prepare("UPDATE codes SET attempts = attempts + 1 WHERE rowid = ?").bind(row.rowid).run();
    const left = CODE_ATTEMPTS - row.attempts - 1;
    const hint = left === 1 ? "Została 1 próba." : `Zostały ${left} próby.`;
    return json({ ok: false, error: left > 0 ? `Zły kod. ${hint}` : "Za dużo prób. Wyślij nowy kod." }, 422);
  }

  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM codes WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), email, now + SESSION_TTL),
  ]);

  return json({ ok: true, token, expiresAt: now + SESSION_TTL, ...(await linkPayload(request, env, email)) });
}

/* ------------------------------------------------------------------ */
/* Link firmy                                                           */
/* ------------------------------------------------------------------ */

async function getLink(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Tylko GET albo PUT." }, 405);
  const email = await sessionEmail(request, env);
  if (!email) return json({ ok: false, error: "Sesja wygasła. Potwierdź adres jeszcze raz." }, 401);
  return json({ ok: true, ...(await linkPayload(request, env, email)) });
}

async function saveLink(request, env, ctx) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ ok: false, error: "Sesja wygasła. Potwierdź adres jeszcze raz." }, 401);
  const input = await readJson(request);
  if (!input) return json({ ok: false, error: "Nieprawidłowe dane." }, 400);

  const name = clean(input.name, 80);
  if (name.length < 2) return json({ ok: false, error: "Podaj nazwę firmy.", field: "name" }, 422);
  const google = normalizeGoogleUrl(input.google);
  if (google.error) return json({ ok: false, error: google.error, field: "google" }, 422);
  let feedbackUrl = null;
  if (input.feedbackMode === "url") {
    const site = normalizeSiteUrl(input.feedbackUrl);
    if (site.error) return json({ ok: false, error: site.error, field: "feedbackUrl" }, 422);
    feedbackUrl = site.url;
  }
  const marketing = input.marketing ? 1 : 0;
  const now = Date.now();

  const existing = await env.DB.prepare("SELECT id FROM links WHERE email = ?").bind(email).first();
  if (existing) {
    await env.DB.prepare("UPDATE links SET name = ?, google_url = ?, feedback_url = ?, marketing = ?, updated_at = ? WHERE id = ?")
      .bind(name, google.url, feedbackUrl, marketing, now, existing.id)
      .run();
    return json({ ok: true, created: false, ...(await linkPayload(request, env, email)) });
  }

  let id = null;
  for (let i = 0; i < 5 && !id; i++) {
    const candidate = randomId(6);
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO links (id, email, name, google_url, feedback_url, disabled, marketing, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
    )
      .bind(candidate, email, name, google.url, feedbackUrl, marketing, now, now)
      .run();
    if (result.meta.changes === 1) id = candidate;
  }
  if (!id) return json({ ok: false, error: "Nie udało się zapisać linku. Spróbuj jeszcze raz." }, 500);

  const publicUrl = `${publicOrigin(request, env)}/o/${id}`;
  ctx.waitUntil(
    sendMail(env, {
      to: email,
      subject: "Twój link do opinii jest gotowy",
      text: [
        `Link dla klientów firmy ${name}:`,
        publicUrl,
        "",
        "Wyślij go klientowi na koniec zlecenia - SMS-em, mailem albo na WhatsAppie.",
        "Zadowoleni trafią prosto do Google, a uwagi przyjdą na ten adres.",
        "",
        `Zmiana danych: wejdź na ${publicOrigin(request, env)} i kliknij „Mam już link”. Adres linku się nie zmieni.`,
        "",
        `Chcesz, żeby link szedł do klientów sam? ${env.CONTACT_URL}`,
      ].join("\n"),
    }).catch((error) => console.error("mail z linkiem:", error)),
  );

  return json({ ok: true, created: true, ...(await linkPayload(request, env, email)) });
}

async function linkPayload(request, env, email) {
  const link = await env.DB.prepare("SELECT id, name, google_url, feedback_url, marketing, disabled FROM links WHERE email = ?")
    .bind(email)
    .first();
  if (!link) return { email, link: null, stats: null };

  const since = Date.now() - 7 * DAY;
  const [totals, week] = await env.DB.batch([
    env.DB.prepare("SELECT kind, stars, COUNT(*) AS n FROM events WHERE link_id = ? GROUP BY kind, stars").bind(link.id),
    env.DB.prepare(
      "SELECT CAST((? - created_at) / 86400000 AS INTEGER) AS day, kind, stars, COUNT(*) AS n FROM events WHERE link_id = ? AND created_at > ? GROUP BY day, kind, stars",
    ).bind(Date.now(), link.id, since),
  ]);

  const stats = { views: 0, google: 0, feedback: 0, ratings: [0, 0, 0, 0, 0], week: Array.from({ length: 7 }, () => ({ good: 0, bad: 0, views: 0, google: 0, feedback: 0 })) };
  for (const row of totals.results) {
    if (row.kind === "view") stats.views += row.n;
    if (row.kind === "google") stats.google += row.n;
    if (row.kind === "feedback") stats.feedback += row.n;
    if (row.kind === "rate" && row.stars >= 1 && row.stars <= 5) stats.ratings[row.stars - 1] += row.n;
  }
  for (const row of week.results) {
    const day = stats.week[row.day];
    if (!day) continue;
    if (row.kind === "view") day.views += row.n;
    if (row.kind === "google") day.google += row.n;
    if (row.kind === "feedback") day.feedback += row.n;
    if (row.kind === "rate") row.stars >= 4 ? (day.good += row.n) : (day.bad += row.n);
  }

  const google = normalizeGoogleUrl(link.google_url);
  return {
    email,
    link: {
      id: link.id,
      url: `${publicOrigin(request, env)}/o/${link.id}`,
      name: link.name,
      google: link.google_url,
      googleKind: google.kind ?? null,
      feedbackMode: link.feedback_url ? "url" : "email",
      feedbackUrl: link.feedback_url,
      marketing: Boolean(link.marketing),
      disabled: Boolean(link.disabled),
    },
    stats,
  };
}

async function sessionEmail(request, env) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token.length < 20) return null;
  const row = await env.DB.prepare("SELECT email FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256(token), Date.now())
    .first();
  return row?.email ?? null;
}

/* ------------------------------------------------------------------ */
/* Pomocnicze                                                           */
/* ------------------------------------------------------------------ */

async function sendMail(env, { to, subject, text, replyTo }) {
  await env.EMAIL.send({
    from: { name: env.MAIL_FROM_NAME, email: env.MAIL_FROM },
    to,
    ...(replyTo ? { replyTo } : {}),
    subject,
    text,
    html: emailHtml(text),
  });
}

/** Prosty szablon w barwach Design House. Bez obrazków - klienty poczty często je blokują. */
function emailHtml(text) {
  return `<!doctype html><html lang="pl"><body style="margin:0;padding:24px 12px;background:#f1f0ee">
<div style="max-width:560px;margin:0 auto;overflow:hidden;border:1px solid #e8e5e1;border-radius:20px;background:#ffffff">
<div style="padding:18px 24px;background:#111214;color:#ffffff;font:700 16px/1.2 -apple-system,Segoe UI,Arial,sans-serif;letter-spacing:.01em">Design House <span style="color:#ff6a2b">&#9679;</span> <span style="font-weight:500;color:#cfcac4">Link do opinii</span></div>
<div style="padding:24px;font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#1c1b1a;white-space:pre-wrap">${escapeHtml(text)}</div>
</div>
<p style="max-width:560px;margin:14px auto 0;font:12px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#a29d97;text-align:center">Design House · <a href="https://designhouse.me" style="color:#a29d97">designhouse.me</a></p>
</body></html>`;
}

async function turnstileOk(env, token, request) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", String(token));
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) body.append("remoteip", ip);
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body }).then((r) => r.json());
  return Boolean(result.success);
}

async function countSince(env, sql, ...params) {
  const row = await env.DB.prepare(sql).bind(...params).first();
  return row?.n ?? 0;
}

function publicOrigin(request, env) {
  return env.PUBLIC_ORIGIN || new URL(request.url).origin;
}

async function ipHash(request, env) {
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  return (await sha256(`${ip}:${env.HASH_PEPPER ?? "dh-opinie"}`)).slice(0, 24);
}

async function codeHash(env, email, code) {
  return sha256(`${email}:${code}:${env.HASH_PEPPER ?? "dh-opinie"}`);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomDigits(length) {
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return [...bytes].map((n) => n % 10).join("");
}

function randomId(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((n) => ID_ALPHABET[n % ID_ALPHABET.length]).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toStars(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function clean(value, max) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function safeHost(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** JSON do <script type="application/json">: każdy `<` jako \u003c, żeby nazwa firmy nie zamknęła skryptu. */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
