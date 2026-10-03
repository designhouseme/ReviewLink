/**
 * Worker ReviewLink. Statyczne pliki idą prosto z `public/`, ten kod
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
import { galleryHtml, sampleEmails } from "./email-samples.js";
import { codeEmail, feedbackEmail, linkReadyEmail, weeklyEmail } from "./emails.js";
import { RESEND_BATCH_MAX, sendBatch, sendMail } from "./mailer.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CODE_TTL = 15 * MINUTE;
const CODE_ATTEMPTS = 5;
const SESSION_TTL = 7 * DAY;
const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const TZ = "Europe/Warsaw";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      const review = pathname.match(/^\/o\/([A-Za-z0-9]{3,20})\/?$/);
      if (review && request.method === "GET") return reviewPage(request, env, review[1].toLowerCase());

      // Wypis z raportów: chroni go podpis w adresie, a one-click z Gmaila przychodzi z obcym Origin.
      if (pathname === "/api/raport/wypisz") return unsubscribe(request, env, url);

      if (pathname.startsWith("/api/")) {
        if (request.method === "POST" || request.method === "PUT") {
          const origin = request.headers.get("origin");
          if (origin && safeHost(origin) !== url.hostname) return json({ ok: false, error: "Niedozwolone źródło." }, 403);
        }

        if (pathname === "/api/config") return json({ ok: true, turnstile: env.TURNSTILE_SITE_KEY || null });
        if (pathname.startsWith("/api/dev/maile")) return devEmails(request, env, pathname);
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

  // Cron z wrangler.jsonc: w poniedziałek rano raport z poprzedniego tygodnia.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(weeklyReports(env, controller.scheduledTime));
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

  const replyTo = normalizeEmail(contact) || undefined;
  const mail = feedbackEmail({ origin: publicOrigin(request, env), company: link.name, stars, message, name, contact, replyTo });

  try {
    await sendMail(env, { to: link.email, replyTo, tag: "feedback", ...mail });
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
    await sendMail(env, { to: email, tag: "code", ...codeEmail({ origin: publicOrigin(request, env), code }) });
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
    sendMail(env, { to: email, tag: "link", ...linkReadyEmail({ origin: publicOrigin(request, env), name, url: publicUrl }) }).catch((error) =>
      console.error("mail z linkiem:", error),
    ),
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
/* Raport tygodniowy                                                    */
/* ------------------------------------------------------------------ */

/**
 * Raport z poprzedniego pełnego tygodnia (pn 00:00 – nd 24:00 czasu warszawskiego)
 * do każdej firmy, u której coś się działo i która się nie wypisała. Po wysłanej
 * paczce zapisujemy `report_week`, więc ponowne uruchomienie nie wyśle drugi raz.
 */
async function weeklyReports(env, now = Date.now()) {
  const origin = env.PUBLIC_ORIGIN;
  if (!origin) throw new Error("raport: brak PUBLIC_ORIGIN, nie ma z czego zbudować linków.");

  const { bounds, prevStart, weekId } = previousWeek(now);
  const [start, end] = [bounds[0], bounds[7]];
  const dayCase = `CASE ${bounds.slice(1, 7).map((_, i) => `WHEN created_at < ? THEN ${i}`).join(" ")} ELSE 6 END`;

  const [links, current, previous] = await env.DB.batch([
    env.DB.prepare("SELECT id, email, name FROM links WHERE disabled = 0 AND weekly = 1 AND (report_week IS NULL OR report_week <> ?) ORDER BY id").bind(weekId),
    env.DB.prepare(
      `SELECT link_id, kind, stars, ${dayCase} AS day, COUNT(*) AS n FROM events WHERE created_at >= ? AND created_at < ? GROUP BY link_id, kind, stars, day`,
    ).bind(...bounds.slice(1, 7), start, end),
    env.DB.prepare("SELECT link_id, kind, COUNT(*) AS n FROM events WHERE created_at >= ? AND created_at < ? GROUP BY link_id, kind").bind(prevStart, start),
  ]);

  const stats = new Map();
  const of = (id) => {
    if (!stats.has(id)) {
      stats.set(id, {
        week: { views: 0, ratings: 0, good: 0, bad: 0, google: 0, feedback: 0 },
        prev: { views: 0, ratings: 0, google: 0 },
        dist: [0, 0, 0, 0, 0],
        days: Array.from({ length: 7 }, () => ({ good: 0, bad: 0 })),
      });
    }
    return stats.get(id);
  };
  for (const row of current.results) {
    const s = of(row.link_id);
    if (row.kind === "view") s.week.views += row.n;
    if (row.kind === "google") s.week.google += row.n;
    if (row.kind === "feedback") s.week.feedback += row.n;
    if (row.kind === "rate" && row.stars >= 1 && row.stars <= 5) {
      s.week.ratings += row.n;
      s.dist[row.stars - 1] += row.n;
      if (row.stars >= 4) {
        s.week.good += row.n;
        s.days[row.day].good += row.n;
      } else {
        s.week.bad += row.n;
        s.days[row.day].bad += row.n;
      }
    }
  }
  for (const row of previous.results) {
    if (!stats.has(row.link_id)) continue;
    const s = stats.get(row.link_id);
    if (row.kind === "view") s.prev.views += row.n;
    if (row.kind === "rate") s.prev.ratings += row.n;
    if (row.kind === "google") s.prev.google += row.n;
  }

  const day = new Intl.DateTimeFormat("pl-PL", { timeZone: TZ, day: "numeric", month: "long" });
  const range = { from: day.format(start), to: day.format(end - 1) };
  const due = links.results.filter((link) => stats.has(link.id)); // tydzień samych zer to szum, nie raport

  let sent = 0;
  for (let i = 0; i < due.length; i += RESEND_BATCH_MAX) {
    const chunk = due.slice(i, i + RESEND_BATCH_MAX);
    const mails = await Promise.all(
      chunk.map(async (link) => {
        const unsubscribeUrl = `${origin}/api/raport/wypisz?l=${link.id}&s=${await unsubscribeSig(env, link.id)}`;
        return {
          to: link.email,
          tag: "weekly",
          headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          ...weeklyEmail({ origin, name: link.name, range, ...stats.get(link.id), unsubscribeUrl }),
        };
      }),
    );
    try {
      const ids = chunk.map((link) => link.id);
      await sendBatch(env, mails, { idempotencyKey: `weekly-${weekId}-${(await sha256(ids.join(","))).slice(0, 16)}` });
      await env.DB.prepare(`UPDATE links SET report_week = ? WHERE id IN (${ids.map(() => "?").join(",")})`).bind(weekId, ...ids).run();
      sent += chunk.length;
    } catch (error) {
      console.error(`raport ${weekId}, paczka od ${i}:`, error);
    }
  }
  console.log(`raport ${weekId}: wysłane ${sent} z ${due.length} (firm z raportem: ${links.results.length})`);
}

/** Granice poprzedniego tygodnia pn–nd w czasie warszawskim: 8 północy (pn … następny pn). */
function previousWeek(now) {
  const local = new Date(now + tzOffset(now)); // pola UTC = czas warszawski
  const monday = local.getUTCDate() - ((local.getUTCDay() + 6) % 7);
  const midnight = (k) => {
    const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), monday + k));
    return warsawMidnight(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  const bounds = Array.from({ length: 8 }, (_, k) => midnight(k - 7));
  const first = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), monday - 7));
  return { bounds, prevStart: midnight(-14), weekId: first.toISOString().slice(0, 10) };
}

/** Północ czasu warszawskiego dla daty (miesiąc od 0). Dwa kroki, bo przesunięcie zależy od chwili (zmiana czasu). */
function warsawMidnight(y, m, d) {
  const naive = Date.UTC(y, m, d);
  const guess = naive - tzOffset(naive);
  return naive - tzOffset(guess);
}

/** O ile czas warszawski wyprzedza UTC w chwili t (ms). */
function tzOffset(t) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const p = Object.fromEntries(f.formatToParts(t).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

/**
 * Wypis z raportów. GET pokazuje przycisk (skanery poczty otwierają linki, więc GET niczego
 * nie zmienia), POST wypisuje - także one-click z nagłówka List-Unsubscribe-Post.
 */
async function unsubscribe(request, env, url) {
  const id = String(url.searchParams.get("l") ?? "").toLowerCase();
  const sig = String(url.searchParams.get("s") ?? "");
  const valid = /^[a-z0-9]{3,20}$/.test(id) && timingSafeEqual(sig, await unsubscribeSig(env, id));
  if (!valid) return page("Ten link nie działa", "Adres do wypisania jest niepełny. Skopiuj go jeszcze raz z maila z raportem.", 400);

  if (request.method === "POST") {
    await env.DB.prepare("UPDATE links SET weekly = 0 WHERE id = ?").bind(id).run();
    return page("Wypisano z raportów", "Nie wyślemy już cotygodniowych podsumowań. Uwagi od klientów dalej będą przychodzić na Twój e-mail.");
  }
  if (request.method !== "GET") return page("Tylko GET albo POST", "", 405);
  return page(
    "Wypisać z raportów?",
    "Przestaniemy wysyłać cotygodniowe podsumowanie. Uwagi od klientów dalej będą przychodzić na Twój e-mail.",
    200,
    `<form method="post"><button type="submit">Wypisz mnie z raportów</button></form>`,
  );
}

async function unsubscribeSig(env, id) {
  return (await sha256(`weekly:${id}:${env.HASH_PEPPER ?? "dh-opinie"}`)).slice(0, 32);
}

/** Mała strona w stylu aplikacji (wypis z raportów). Treści są stałe, bez danych od użytkownika. */
function page(title, text, status = 200, extra = "") {
  return new Response(
    `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} · ReviewLink</title>
<style>
@font-face{font-family:Urbanist;font-weight:100 900;src:url(/mail/urbanist-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+2000-206F}
@font-face{font-family:Urbanist;font-weight:100 900;src:url(/mail/urbanist-latin-ext.woff2) format("woff2");unicode-range:U+0100-02FF}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:radial-gradient(110% 52% at 8% -12%,#f8ddcc 0%,rgb(248 221 204/0) 62%),#f1f0ee;color:#1c1b1a;font-family:Urbanist,system-ui,sans-serif}
main{max-width:460px;padding:40px 36px;border:1px solid #e8e5e1;border-radius:28px;background:#fff}
img{display:block;height:20px;margin-bottom:28px}
h1{margin:0;font-size:34px;font-weight:300;line-height:1.08;letter-spacing:-.02em}
p{margin:14px 0 0;color:#6c6863;font-size:16px;line-height:1.55}
button{margin-top:26px;padding:17px 28px;border:0;border-radius:999px;background:#ff6a2b;color:#fff;font:600 16px Urbanist,system-ui,sans-serif;cursor:pointer}
</style></head><body><main><img src="/brand/logo-dark.svg" alt="Design House"><h1>${title}</h1>${text ? `<p>${text}</p>` : ""}${extra}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
}

/**
 * Podgląd maili dla dewelopera: /api/dev/maile (galeria) i /api/dev/maile/:id (sam mail).
 * Tylko z DEV_SHOW_CODE=1, czyli lokalnie; na produkcji to zwykłe 404.
 */
function devEmails(request, env, pathname) {
  if (env.DEV_SHOW_CODE !== "1") return json({ ok: false, error: "Nie ma takiego adresu." }, 404);
  const origin = publicOrigin(request, env);
  const samples = sampleEmails(origin);
  const html = (body) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  const id = pathname.replace(/^\/api\/dev\/maile\/?/, "");
  if (!id) return html(galleryHtml(samples, (sample) => `/api/dev/maile/${sample}`, origin));
  const sample = samples.find((s) => s.id === id);
  return sample ? html(sample.mail.html) : json({ ok: false, error: "Nie ma takiego maila." }, 404);
}

/* ------------------------------------------------------------------ */
/* Pomocnicze                                                           */
/* ------------------------------------------------------------------ */

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
