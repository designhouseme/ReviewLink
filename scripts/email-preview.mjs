// Podgląd maili z przykładowymi danymi: node scripts/email-preview.mjs
// Zapisuje HTML do .wrangler/email-preview/ (grafiki z lokalnego public/).
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { codeEmail, linkReadyEmail, feedbackEmail, weeklyEmail } from "../src/emails.js";

const out = resolve(".wrangler/email-preview");
mkdirSync(out, { recursive: true });
const origin = pathToFileURL(resolve("public")).href;
const name = "MIREC Usługi Remontowe";

const mails = {
  kod: codeEmail({ origin, code: "482913" }),
  link: linkReadyEmail({ origin, name, url: "https://dh-opinie.maciej-36d.workers.dev/o/k3x9ab" }),
  uwagi: feedbackEmail({
    origin,
    company: name,
    stars: 2,
    message: "Remont łazienki wyszedł ładnie, ale ekipa spóźniła się dwa razy po dwie godziny.\nByłoby super dostać SMS-a, gdy coś się przesuwa.",
    name: "Anna",
    contact: "anna.nowak@example.com",
    replyTo: "anna.nowak@example.com",
  }),
  tydzien: weeklyEmail({
    origin,
    name,
    range: { from: "28 września", to: "4 października" },
    week: { views: 41, ratings: 17, good: 14, bad: 3, google: 11, feedback: 2 },
    prev: { views: 33, ratings: 12, google: 11 },
    dist: [1, 1, 1, 4, 10],
    days: [{ good: 2, bad: 0 }, { good: 3, bad: 1 }, { good: 1, bad: 0 }, { good: 4, bad: 1 }, { good: 2, bad: 1 }, { good: 2, bad: 0 }, { good: 0, bad: 0 }],
    unsubscribeUrl: "https://dh-opinie.maciej-36d.workers.dev/api/raport/wypisz?l=k3x9ab&s=…",
  }),
};
for (const [key, mail] of Object.entries(mails)) {
  writeFileSync(`${out}/${key}.html`, mail.html);
  writeFileSync(`${out}/${key}.txt`, `Temat: ${mail.subject}\n\n${mail.text}\n`);
}
console.log(out);
