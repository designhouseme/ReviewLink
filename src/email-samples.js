/**
 * Przykładowe maile i galeria do podglądu. Tylko dla dewelopera:
 * - `npm run dev` → http://localhost:8790/api/dev/maile (działa tylko z DEV_SHOW_CODE=1),
 * - `node scripts/email-preview.mjs` → pliki w .wrangler/email-preview/.
 */

import { codeEmail, esc, feedbackEmail, linkReadyEmail, weeklyEmail } from "./emails.js";

export function sampleEmails(origin) {
  const name = "MIREC Usługi Remontowe";
  const unsubscribeUrl = `${origin}/api/raport/wypisz?l=demo123&s=podglad`;
  const range = { from: "28 września", to: "4 października" };
  const days = (pairs) => pairs.map(([good, bad]) => ({ good, bad }));
  return [
    {
      id: "tydzien",
      label: "Podsumowanie tygodnia",
      note: "Poniedziałek rano, do firm z ruchem w minionym tygodniu.",
      mail: weeklyEmail({
        origin,
        name,
        range,
        week: { views: 41, ratings: 17, good: 14, bad: 3, google: 11, feedback: 2 },
        prev: { views: 33, ratings: 12, google: 11 },
        dist: [1, 1, 1, 4, 10],
        days: days([[2, 0], [3, 1], [1, 0], [4, 1], [2, 1], [2, 0], [0, 0]]),
        unsubscribeUrl,
      }),
    },
    {
      id: "tydzien-bez-ocen",
      label: "Podsumowanie: tydzień bez ocen",
      note: "Ktoś otworzył link, ale nikt nie wybrał gwiazdek.",
      mail: weeklyEmail({
        origin,
        name,
        range,
        week: { views: 6, ratings: 0, good: 0, bad: 0, google: 0, feedback: 0 },
        prev: { views: 9, ratings: 3, google: 2 },
        dist: [0, 0, 0, 0, 0],
        days: days([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]),
        unsubscribeUrl,
      }),
    },
    {
      id: "uwagi",
      label: "Uwagi od klienta",
      note: "1–3 gwiazdki i wiadomość. Klient zostawił e-mail, więc można odpowiedzieć.",
      mail: feedbackEmail({
        origin,
        company: name,
        stars: 2,
        message: "Remont łazienki wyszedł ładnie, ale ekipa spóźniła się dwa razy po dwie godziny.\nByłoby super dostać SMS-a, gdy coś się przesuwa.",
        name: "Anna",
        contact: "anna.nowak@example.com",
        replyTo: "anna.nowak@example.com",
      }),
    },
    {
      id: "uwagi-anonim",
      label: "Uwagi bez kontaktu",
      note: "Klient nie podał imienia ani kontaktu.",
      mail: feedbackEmail({ origin, company: name, stars: 3, message: "Wszystko OK, tylko sprzątanie po pracy mogłoby być dokładniejsze.", name: "", contact: "" }),
    },
    {
      id: "link",
      label: "Link gotowy",
      note: "Po pierwszym zapisie linku.",
      mail: linkReadyEmail({ origin, name, url: `${origin}/o/k3x9ab` }),
    },
    {
      id: "kod",
      label: "Kod logowania",
      note: "Zamiast konta i hasła.",
      mail: codeEmail({ origin, code: "482913" }),
    },
  ];
}

/** Galeria: każdy mail na desktopie (680 px) i na telefonie (390 px), z tematem i wersją tekstową. */
export function galleryHtml(samples, srcFor, origin) {
  const cards = samples
    .map(
      (s) => `<section id="${s.id}">
  <header><h2>${esc(s.label)}</h2><p>${esc(s.note)}</p><p class="subject"><b>Temat:</b> ${esc(s.mail.subject)}</p></header>
  <div class="frames">
    <figure><figcaption>Desktop</figcaption><iframe src="${srcFor(s.id)}" width="680" loading="lazy"></iframe></figure>
    <figure><figcaption>Telefon</figcaption><iframe src="${srcFor(s.id)}" width="390" loading="lazy"></iframe></figure>
  </div>
  <details><summary>Wersja tekstowa</summary><pre>${esc(s.mail.text)}</pre></details>
</section>`,
    )
    .join("\n");
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Maile · ReviewLink</title>
<style>
@font-face{font-family:Urbanist;font-weight:100 900;src:url(${origin}/mail/urbanist-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+2000-206F}
@font-face{font-family:Urbanist;font-weight:100 900;src:url(${origin}/mail/urbanist-latin-ext.woff2) format("woff2");unicode-range:U+0100-02FF}
body{margin:0;padding:40px 24px 80px;background:radial-gradient(110% 40% at 8% -8%,#f8ddcc 0%,rgb(248 221 204/0) 62%),#e9e7e4;color:#1c1b1a;font-family:Urbanist,system-ui,sans-serif}
h1{margin:0 auto 6px;max-width:1120px;font-size:40px;font-weight:300;letter-spacing:-.02em}
.lead{margin:0 auto 32px;max-width:1120px;color:#6c6863;font-size:16px}
nav{max-width:1120px;margin:0 auto 36px;display:flex;flex-wrap:wrap;gap:8px}
nav a{padding:9px 16px;border:1px solid #d8d3cd;border-radius:999px;background:#fff;color:#1c1b1a;text-decoration:none;font-size:14px;font-weight:600}
section{max-width:1120px;margin:0 auto 56px;padding:28px;border:1px solid #d8d3cd;border-radius:28px;background:rgb(255 255 255/.55)}
h2{margin:0;font-size:24px;font-weight:600}
header p{margin:6px 0 0;color:#6c6863}
.subject{font-size:14px}
.frames{display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start;margin-top:22px}
figure{margin:0}
figcaption{margin-bottom:8px;color:#a29d97;font-size:13px;font-weight:600}
iframe{display:block;height:600px;border:1px solid #d8d3cd;border-radius:18px;background:#f1f0ee;box-shadow:0 30px 60px -40px rgb(28 27 26/.45)}
details{margin-top:18px}
summary{cursor:pointer;color:#6c6863;font-size:14px;font-weight:600}
pre{white-space:pre-wrap;padding:16px;border-radius:14px;background:#fff;font-size:13px}
</style></head><body>
<h1>Maile ReviewLink</h1>
<p class="lead">Podgląd z przykładowymi danymi. Szablony są w <code>src/emails.js</code>, a przykłady w <code>src/email-samples.js</code>.</p>
<nav>${samples.map((s) => `<a href="#${s.id}">${esc(s.label)}</a>`).join("")}</nav>
${cards}
<script>
for (const f of document.querySelectorAll("iframe")) f.addEventListener("load", () => { f.style.height = f.contentDocument.documentElement.scrollHeight + "px"; });
</script>
</body></html>`;
}
