/**
 * Wysyłka maili przez SMTP skrzynki MAIL_FROM.
 *
 * Worker łączy się gniazdem TCP (`cloudflare:sockets`) z SMTP_HOST na porcie 587
 * i przechodzi na TLS przez STARTTLS. Port 25 jest w Workers zablokowany. Hasło
 * to sekret SMTP_PASSWORD. Bez niego maile wychodzą tylko w trybie
 * deweloperskim (DEV_SHOW_CODE=1): lądują wtedy w konsoli `wrangler dev`. Na
 * produkcji brak hasła to błąd, a nie ciche gubienie wiadomości.
 *
 * SPF i DKIM to sprawa serwera SMTP, my tylko składamy wiadomość: nagłówki
 * w RFC 2047, treść w quoted-printable.
 */

import { connect } from "cloudflare:sockets";

const TIMEOUT = 20_000;
const PER_CONNECTION = 25;

/** Jeden mail: { to, subject, html, text, replyTo?, headers?, tag? }. */
export async function sendMail(env, mail) {
  const [result] = await sendMany(env, [mail]);
  if (result.error) throw result.error;
}

/**
 * Wiele maili po kolei, jednym połączeniem na każde PER_CONNECTION (raporty
 * tygodniowe). Zwraca { ok: true } albo { error } dla każdego maila, w tej samej
 * kolejności: odrzucony adres nie zatrzymuje pozostałych.
 */
export async function sendMany(env, mails) {
  if (!env.SMTP_PASSWORD) {
    if (env.DEV_SHOW_CODE === "1") {
      for (const mail of mails) console.log(`[mail dev] do: ${mail.to}\nTemat: ${mail.subject}\n\n${mail.text}\n`);
      return mails.map(() => ({ ok: true, dev: true }));
    }
    throw new Error("Brak SMTP_PASSWORD: maile nie mogą wyjść.");
  }
  const results = [];
  for (let i = 0; i < mails.length; i += PER_CONNECTION) {
    results.push(...(await session(env, mails.slice(i, i + PER_CONNECTION))));
  }
  return results;
}

export const SMTP_PER_CONNECTION = PER_CONNECTION;

async function session(env, mails) {
  const from = env.MAIL_FROM;
  const domain = from.split("@")[1];
  // Zły adres psuje tylko swój mail, więc wiadomości składamy przed połączeniem.
  const prepared = mails.map((mail) => {
    try {
      const to = address(mail.to);
      return { to, data: message(env, { ...mail, to }, domain).replace(/^\./gm, "..") };
    } catch (error) {
      return { error };
    }
  });
  const results = prepared.map(({ error }) => ({ error: error ?? new Error("SMTP: mail nie został wysłany.") }));
  if (prepared.every((mail) => mail.error)) return results;

  let smtp;
  try {
    smtp = new Smtp(connect({ hostname: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587) }, { secureTransport: "starttls" }));
    await smtp.expect(null, 220);
    await smtp.expect(`EHLO ${domain}`, 250);
    await smtp.expect("STARTTLS", 220);
    smtp.upgrade();
    await smtp.expect(`EHLO ${domain}`, 250);
    await smtp.expect(`AUTH PLAIN ${base64(`\0${env.SMTP_USER || from}\0${env.SMTP_PASSWORD}`)}`, 235);

    for (const [i, { to, data, error }] of prepared.entries()) {
      if (error) continue;
      try {
        await smtp.expect(`MAIL FROM:<${from}>`, 250);
        await smtp.expect(`RCPT TO:<${to}>`, 250);
        await smtp.expect("DATA", 354);
        await smtp.expect(`${data}\r\n.`, 250);
        results[i] = { ok: true };
      } catch (error) {
        results[i] = { error };
        // Odpowiedź serwera (np. 550 na adres) psuje tylko ten mail; zerwane połączenie wszystkie dalsze.
        if (!(error instanceof SmtpReply) || error.code === 421) throw error;
        await smtp.expect("RSET", 250);
      }
    }
    await smtp.expect("QUIT", 221).catch(() => {});
  } catch (error) {
    prepared.forEach((mail, i) => {
      if (!mail.error && !results[i].ok) results[i] = { error };
    });
  } finally {
    smtp?.close();
  }
  return results;
}

/** Odpowiedź serwera inna niż oczekiwana. */
class SmtpReply extends Error {
  constructor(command, code, text) {
    super(`SMTP ${code} po ${command.split(" ")[0] || "połączeniu"}: ${text.slice(0, 300)}`);
    this.code = code;
  }
}

class Smtp {
  constructor(socket) {
    this.socket = socket;
    this.attach();
  }

  attach() {
    this.reader = this.socket.readable.getReader();
    this.writer = this.socket.writable.getWriter();
    this.decoder = new TextDecoder();
    this.buffer = "";
  }

  upgrade() {
    this.reader.releaseLock();
    this.writer.releaseLock();
    this.socket = this.socket.startTls();
    this.attach();
  }

  /** Wysyła komendę (null = tylko czeka na powitanie) i sprawdza kod odpowiedzi. */
  async expect(command, code) {
    if (command !== null) await this.writer.write(new TextEncoder().encode(`${command}\r\n`));
    const reply = await withTimeout(this.reply(), TIMEOUT);
    if (reply.code !== code) throw new SmtpReply(command ?? "", reply.code, reply.text);
    return reply;
  }

  /** Odpowiedź może mieć wiele linii ("250-…"), ostatnia ma spację po kodzie. */
  async reply() {
    const lines = [];
    for (;;) {
      const end = this.buffer.indexOf("\n");
      if (end === -1) {
        const { value, done } = await this.reader.read();
        if (done) throw new Error("SMTP: serwer zamknął połączenie.");
        this.buffer += this.decoder.decode(value, { stream: true });
        continue;
      }
      const line = this.buffer.slice(0, end).replace(/\r$/, "");
      this.buffer = this.buffer.slice(end + 1);
      lines.push(line);
      if (!/^\d{3}-/.test(line)) return { code: Number(line.slice(0, 3)), text: lines.join(" | ") };
    }
  }

  close() {
    this.socket.close().catch(() => {});
  }
}

function message(env, { to, subject, html, text, replyTo, headers }, domain) {
  const boundary = `rl-${crypto.randomUUID()}`;
  const lines = [
    `From: ${displayName(env.MAIL_FROM_NAME)} <${env.MAIL_FROM}>`,
    `To: <${to}>`,
    ...(replyTo ? [`Reply-To: <${address(replyTo)}>`] : []),
    `Subject: ${encodeWord(subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    ...Object.entries(headers ?? {}).map(([name, value]) => `${name}: ${oneLine(value)}`),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...part("text/plain", text),
    `--${boundary}`,
    ...part("text/html", html),
    `--${boundary}--`,
  ];
  return lines.join("\r\n");
}

function part(type, body) {
  return [`Content-Type: ${type}; charset=utf-8`, "Content-Transfer-Encoding: quoted-printable", "", quotedPrintable(body)];
}

/** Adres do koperty i nagłówka: bez spacji, nawiasów i nowych linii. */
function address(value) {
  const email = String(value ?? "").trim();
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(email)) throw new Error(`SMTP: zły adres ${JSON.stringify(email)}.`);
  return email;
}

function oneLine(value) {
  return String(value).replace(/[\r\n]+/g, " ");
}

/** Nazwa nadawcy: z polskimi znakami jako słowo RFC 2047, ze znakami specjalnymi w cudzysłowie. */
function displayName(value) {
  const name = encodeWord(value ?? "");
  return name.startsWith("=?") || !/[()<>[\]:;@\\,."]/.test(name) ? name : `"${name.replace(/["\\]/g, "\\$&")}"`;
}

/** RFC 2047: tekst z polskimi znakami jako =?UTF-8?B?…?=, po najwyżej 45 bajtów na słowo. */
function encodeWord(value) {
  const text = oneLine(value);
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words = [];
  let chunk = "";
  for (const char of text) {
    if (utf8(chunk + char).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${base64(word)}?=`).join("\r\n ");
}

/** RFC 2045: linie do 76 znaków, miękkie łamanie "=", znaki spoza ASCII jako =XX. */
function quotedPrintable(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const bytes = utf8(line);
      const out = [];
      let current = "";
      bytes.forEach((byte, i) => {
        const last = i === bytes.length - 1;
        const plain = (byte >= 33 && byte <= 126 && byte !== 61) || ((byte === 32 || byte === 9) && !last);
        const token = plain ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
        if (current.length + token.length > 75) {
          out.push(`${current}=`);
          current = "";
        }
        current += token;
      });
      out.push(current);
      return out.join("\r\n");
    })
    .join("\r\n");
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

function base64(value) {
  return btoa(String.fromCharCode(...utf8(value)));
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`SMTP: brak odpowiedzi przez ${ms / 1000} s.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
