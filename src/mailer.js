/**
 * Wysyłka maili przez Resend (https://resend.com/docs/api-reference).
 *
 * Potrzebny sekret RESEND_API_KEY, a domena nadawcy (MAIL_FROM) musi być
 * zweryfikowana w Resend, inaczej każda wysyłka kończy się błędem 403.
 * Bez klucza maile wychodzą tylko w trybie deweloperskim (DEV_SHOW_CODE=1):
 * lądują wtedy w konsoli `wrangler dev`. Na produkcji brak klucza to błąd,
 * a nie ciche gubienie wiadomości.
 */

const API = "https://api.resend.com";
const BATCH_MAX = 100;

/** Jeden mail: { to, subject, html, text, replyTo?, headers?, tag? }. */
export async function sendMail(env, mail, { idempotencyKey } = {}) {
  return call(env, "/emails", payload(env, mail), idempotencyKey, [mail]);
}

/** Do 100 maili jednym żądaniem (raporty tygodniowe). Zwraca listę id w tej samej kolejności. */
export async function sendBatch(env, mails, { idempotencyKey } = {}) {
  if (mails.length > BATCH_MAX) throw new Error(`Resend: najwyżej ${BATCH_MAX} maili w paczce.`);
  return call(env, "/emails/batch", mails.map((mail) => payload(env, mail)), idempotencyKey, mails);
}

export const RESEND_BATCH_MAX = BATCH_MAX;

function payload(env, { to, subject, html, text, replyTo, headers, tag }) {
  return {
    from: `"${String(env.MAIL_FROM_NAME).replace(/"/g, "")}" <${env.MAIL_FROM}>`,
    to: [to],
    subject,
    html,
    text,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(headers ? { headers } : {}),
    ...(tag ? { tags: [{ name: "type", value: tag }] } : {}),
  };
}

async function call(env, path, body, idempotencyKey, mails) {
  if (!env.RESEND_API_KEY) {
    if (env.DEV_SHOW_CODE === "1") {
      for (const mail of mails) console.log(`[mail dev] do: ${mail.to}\nTemat: ${mail.subject}\n\n${mail.text}\n`);
      return { dev: true };
    }
    throw new Error("Brak RESEND_API_KEY: maile nie mogą wyjść.");
  }
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey.slice(0, 256) } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}
