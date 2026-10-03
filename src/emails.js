/**
 * Maile ReviewLink w stylu aplikacji: ciepłe tło, biała karta, brzoskwiniowa
 * poświata z ilustracją, jeden pomarańcz, duże cienkie cyfry.
 *
 * Czysty moduł (bez API Workerów), żeby dało się go podejrzeć w Node:
 * `node scripts/email-preview.mjs`. Każdy szablon zwraca { subject, html, text }.
 *
 * Zasady pisania pod klienty poczty: tabele i style inline, 600 px szerokości,
 * kolor `bgcolor` pod każdym gradientem, grafiki tylko jako PNG i nigdy jako
 * nośnik treści (z zablokowanymi obrazkami mail dalej ma sens). Urbanist ładuje
 * się tylko w Apple Mail, reszta dostaje systemowy bezszeryfowy.
 */

const FONT = "Urbanist,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const C = {
  bg: "#f1f0ee",
  wash: "#f8ddcc",
  ink: "#1c1b1a",
  ink2: "#6c6863",
  ink3: "#a29d97",
  line: "#e8e5e1",
  soft: "#f6f5f3",
  orange: "#ff6a2b",
  orangeSoft: "#ffeadf",
  dark: "#222120",
  up: "#23874c",
  down: "#cf3b25",
};
const RATING_LABELS = ["", "Źle", "Słabo", "Średnio", "Dobrze", "Rewelacja"];
const DAYS = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];

/* ------------------------------------------------------------------ */
/* Kod logowania                                                        */
/* ------------------------------------------------------------------ */

export function codeEmail({ origin, code }) {
  const body = `
    ${box(`<div style="font-family:${FONT};font-size:46px;line-height:1;font-weight:300;letter-spacing:.26em;color:${C.ink};text-align:center;padding-left:.26em">${esc(code)}</div>`, { bg: C.orangeSoft, pad: "30px 16px" })}
    ${gap(22)}
    ${p(`Kod jest ważny <b style="color:${C.ink}">15 minut</b>. Wpisz go na stronie, na której go zamówiłeś.`)}
    ${gap(10)}
    ${small("Jeśli to nie Ty prosiłeś o kod, zignoruj tę wiadomość. Nikt nie zaloguje się bez dostępu do Twojej skrzynki.")}`;
  return {
    subject: `Twój kod: ${code}`,
    html: layout({
      origin,
      preheader: `Kod do ReviewLink: ${code}. Ważny 15 minut.`,
      image: "kod-mail",
      title: "Twój kod do&nbsp;ReviewLink",
      lead: "Jeden kod zamiast konta i hasła.",
      body,
      footer: "Dostajesz tę wiadomość, bo ktoś wpisał ten adres na stronie ReviewLink.",
    }),
    text: lines(`Kod do ReviewLink: ${code}`, "", "Wpisz go na stronie, na której go zamówiłeś. Jest ważny 15 minut.", "Jeśli to nie Ty prosiłeś o kod, zignoruj tę wiadomość."),
  };
}

/* ------------------------------------------------------------------ */
/* Link gotowy                                                          */
/* ------------------------------------------------------------------ */

export function linkReadyEmail({ origin, name, url }) {
  const body = `
    ${box(`
      <div style="font-family:${FONT};font-size:13px;line-height:1;font-weight:600;color:${C.ink3};padding-bottom:10px">Link dla klientów</div>
      <a href="${esc(url)}" style="font-family:${FONT};font-size:19px;line-height:1.35;font-weight:500;color:${C.ink};text-decoration:none;overflow-wrap:anywhere">${esc(url.replace(/^https?:\/\//, ""))}</a>`, { pad: "22px 24px" })}
    ${gap(28)}
    ${steps([
      "Wyślij link klientowi po skończonym zleceniu: SMS-em, mailem albo na komunikatorze.",
      "Zadowoleni klienci trafią prosto do opinii w Google.",
      "Uwagi przy 1–3 gwiazdkach przyjdą na ten adres. Nikt poza Tobą ich nie zobaczy.",
    ])}
    ${gap(12)}
    ${button(origin, "Otwórz panel: kod QR i statystyki")}
    ${gap(24)}
    ${small("Zmiana danych nie zmienia adresu linku. Wysłane wcześniej linki i wydrukowane kody QR dalej działają.")}`;
  return {
    subject: "Twój link do opinii jest gotowy",
    html: layout({
      origin,
      preheader: `Link do opinii dla ${name} jest gotowy. Wyślij go klientowi po zleceniu.`,
      image: "gotowe-link",
      title: "Twój link jest gotowy",
      lead: esc(name),
      body,
      footer: "Dostajesz tę wiadomość, bo założyłeś link w ReviewLink.",
    }),
    text: lines(
      `Link dla klientów firmy ${name}:`,
      url,
      "",
      "Wyślij go klientowi po skończonym zleceniu: SMS-em, mailem albo na komunikatorze.",
      "Zadowoleni trafią prosto do Google, a uwagi przyjdą na ten adres.",
      "",
      `Panel z kodem QR i statystykami: ${origin} („Mam już link”). Adres linku się nie zmieni.`,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Uwagi od klienta (1–3 gwiazdki)                                      */
/* ------------------------------------------------------------------ */

export function feedbackEmail({ origin, company, stars, message, name, contact, replyTo }) {
  const who = [
    row("Klient", name ? esc(name) : `<span style="color:${C.ink3}">nie podał imienia</span>`),
    row("Kontakt", contact ? esc(contact) : `<span style="color:${C.ink3}">nie zostawił kontaktu</span>`),
  ].join("");
  const subject = `Uwagi od klienta${stars ? ` (${stars}/5)` : ""}${name ? ` · ${name}` : ""}`;
  const body = `
    ${stars ? `${starRow(stars, 34)}${gap(10)}<div style="font-family:${FONT};font-size:15px;line-height:1.4;font-weight:600;color:${C.ink}">${stars}/5 · ${RATING_LABELS[stars]}</div>${gap(22)}` : ""}
    ${box(`<div style="font-family:${FONT};font-size:18px;line-height:1.6;color:${C.ink}">${esc(message).replace(/\n/g, "<br>")}</div>`, { pad: "24px 26px", accent: true })}
    ${gap(22)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${who}</table>
    ${gap(26)}
    ${replyTo ? `${button(`mailto:${encodeURIComponent(replyTo)}?subject=${encodeURIComponent(`Re: ${subject}`)}`, "Odpowiedz klientowi")}${gap(12)}${small("Możesz też po prostu odpowiedzieć na tego maila. Wiadomość trafi prosto do klienta.")}${gap(14)}` : ""}
    ${small("Tej wiadomości nie publikujemy i nie zapisujemy. Widzisz ją tylko Ty.")}`;
  const starsLine = stars ? `${"★".repeat(stars)}${"☆".repeat(5 - stars)}  ${stars}/5 · ${RATING_LABELS[stars]}` : "bez oceny";
  return {
    subject,
    html: layout({
      origin,
      preheader: `${stars ? `${stars}/5 · ` : ""}${message.slice(0, 90)}`,
      image: "dzieki-wiadomosc",
      title: "Klient zostawił uwagi",
      lead: esc(company),
      body,
      footer: "Dostajesz tę wiadomość, bo uwagi z Twojego linku trafiają na ten adres.",
    }),
    text: lines(
      `Ocena: ${starsLine}`,
      "",
      message,
      "",
      "-",
      name ? `Klient: ${name}` : "Klient nie podał imienia.",
      contact ? `Kontakt: ${contact}` : "Klient nie zostawił kontaktu.",
      replyTo ? "Odpowiedz na tego maila, a wiadomość trafi prosto do klienta." : "",
      "",
      "Tej wiadomości nie publikujemy. Widzisz ją tylko Ty.",
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Podsumowanie tygodnia                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {object} d
 * @param {{ from: string, to: string }} d.range  np. „28 września” – „4 października”
 * @param {{ views, ratings, good, bad, google, feedback }} d.week
 * @param {{ views, ratings, google }} d.prev     poprzedni tydzień, do strzałek
 * @param {number[]} d.dist                       oceny 1..5
 * @param {{ good, bad }[]} d.days                pn..nd
 */
export function weeklyEmail({ origin, name, range, week, prev, dist, days, unsubscribeUrl }) {
  const metrics = [
    { n: week.ratings, label: plural(week.ratings, "ocena", "oceny", "ocen"), d: week.ratings - prev.ratings },
    { n: week.google, label: "do Google", d: week.google - prev.google, color: C.orange },
    { n: week.views, label: plural(week.views, "wejście", "wejścia", "wejść"), d: week.views - prev.views },
  ];
  const metricCells = metrics
    .map(
      (m, i) => `<td width="33%" valign="top" style="padding:${i ? "0 0 0 14px" : "0"}">
        <div class="num" style="font-family:${FONT};font-size:56px;line-height:1;font-weight:300;letter-spacing:-0.04em;color:${m.color || C.ink}">${m.n}</div>
        <div style="font-family:${FONT};font-size:14px;line-height:1.4;font-weight:500;color:${C.ink2};padding-top:8px">${m.label}</div>
        <div style="font-family:${FONT};font-size:12px;line-height:1.4;color:${m.d > 0 ? C.up : m.d < 0 ? C.down : C.ink3};padding-top:4px">${m.d > 0 ? `▲ ${m.d}` : m.d < 0 ? `▼ ${-m.d}` : "bez zmian"} <span class="art" style="color:${C.ink3}">vs poprzedni</span></div>
      </td>`,
    )
    .join("");

  const maxDist = Math.max(1, ...dist);
  const distRows = [5, 4, 3, 2, 1]
    .map((s) => {
      const n = dist[s - 1];
      const w = Math.round((n / maxDist) * 100);
      return `<tr>
        <td width="44" style="font-family:${FONT};font-size:14px;line-height:1;font-weight:600;color:${C.ink};padding:5px 0;white-space:nowrap">${s} <span style="color:${s >= 4 ? C.orange : C.ink3}">★</span></td>
        <td style="padding:5px 12px 5px 0">${bar(w, s >= 4 ? C.orange : C.dark)}</td>
        <td width="28" align="right" style="font-family:${FONT};font-size:14px;line-height:1;font-weight:500;color:${C.ink2};padding:5px 0">${n}</td>
      </tr>`;
    })
    .join("");

  const maxDay = Math.max(1, ...days.map((x) => x.good + x.bad));
  const H = 96;
  const dayCols = days
    .map((x, i) => {
      const g = Math.round((x.good / maxDay) * H);
      const b = Math.round((x.bad / maxDay) * H);
      const stack =
        (g ? `<tr><td height="${g}" bgcolor="${C.orange}" style="background:${C.orange};border-radius:${b ? "8px 8px 0 0" : "8px"};font-size:0;line-height:0">&nbsp;</td></tr>` : "") +
        (b ? `<tr><td height="${b}" bgcolor="${C.dark}" style="background:${C.dark};border-radius:${g ? "0 0 8px 8px" : "8px"};font-size:0;line-height:0">&nbsp;</td></tr>` : "") +
        (!g && !b ? `<tr><td height="4" bgcolor="${C.line}" style="background:${C.line};border-radius:4px;font-size:0;line-height:0">&nbsp;</td></tr>` : "");
      return `<td width="14%" valign="bottom" align="center" style="padding:0 5px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${stack}</table>
        <div style="font-family:${FONT};font-size:12px;line-height:1;font-weight:500;color:${C.ink3};padding-top:8px">${DAYS[i]}</div>
      </td>`;
    })
    .join("");

  const facts = [];
  if (week.good) facts.push(`Z ${week.good} ${plural(week.good, "oceny", "ocen", "ocen")} 4–5★ do Google ${plural(week.google, "przeszła", "przeszły", "przeszło")} <b style="color:${C.ink}">${week.google} ${plural(week.google, "osoba", "osoby", "osób")}</b>.`);
  if (week.feedback) facts.push(`${week.feedback} ${plural(week.feedback, "wiadomość", "wiadomości", "wiadomości")} z uwagami ${plural(week.feedback, "trafiła", "trafiły", "trafiło")} na Twój e-mail.`);
  if (!week.ratings) facts.push("W tym tygodniu nikt nie wybrał jeszcze gwiazdek. Wyślij link klientom po skończonych zleceniach.");

  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${metricCells}</tr></table>
    ${gap(30)}${hr()}${gap(26)}
    ${heading("Rozkład ocen")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${distRows}</table>
    ${week.ratings ? `${gap(30)}${heading("Dzień po dniu")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${dayCols}</tr></table>${gap(10)}${legend()}` : ""}
    ${gap(28)}
    ${box(facts.map((f) => `<div style="font-family:${FONT};font-size:15px;line-height:1.55;color:${C.ink2};padding:3px 0">${f}</div>`).join(""), { bg: C.orangeSoft, pad: "18px 22px" })}
    ${gap(28)}
    ${button(origin, "Otwórz panel")}`;

  const summary = week.ratings ? `${week.ratings} ${plural(week.ratings, "ocena", "oceny", "ocen")}, ${week.google} do Google` : `${week.views} ${plural(week.views, "wejście", "wejścia", "wejść")}`;
  return {
    subject: `Twój tydzień w ReviewLink: ${summary}`,
    html: layout({
      origin,
      preheader: `${name}, ${range.from} – ${range.to}: ${summary}.`,
      image: "statystyki",
      title: "Twój tydzień",
      lead: `${esc(name)}<br><span style="color:${C.ink3}">${esc(range.from)} – ${esc(range.to)}</span>`,
      body,
      footer: `Raport przychodzi w poniedziałki, jeśli w minionym tygodniu coś się działo.<br><a href="${esc(unsubscribeUrl)}" style="color:${C.ink3};text-decoration:underline">Wypisz się z raportów</a>`,
    }),
    text: lines(
      `Twój tydzień w ReviewLink · ${name}`,
      `${range.from} – ${range.to}`,
      "",
      `Oceny: ${week.ratings} (4–5★: ${week.good}, 1–3★: ${week.bad})`,
      `Do Google: ${week.google}`,
      `Wejścia: ${week.views}`,
      `Uwagi na e-mail: ${week.feedback}`,
      "",
      `Panel: ${origin}`,
      "",
      `Wypisz się z raportów: ${unsubscribeUrl}`,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Szkielet                                                             */
/* ------------------------------------------------------------------ */

function layout({ origin, preheader, image, title, lead, body, footer }) {
  const fontFace = (file, range) =>
    `@font-face{font-family:'Urbanist';font-style:normal;font-weight:100 900;src:url('${origin}/mail/${file}') format('woff2');unicode-range:${range}}`;
  return `<!doctype html>
<html lang="pl" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>ReviewLink</title>
<style>
${fontFace("urbanist-latin.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212")}
${fontFace("urbanist-latin-ext.woff2", "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+20A0-20AB,U+20AD-20C0")}
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
a{color:${C.orange}}
@media (max-width:620px){
  .px{padding-left:24px!important;padding-right:24px!important}
  .h1{font-size:32px!important}
  .col{display:block!important;width:100%!important;padding:0 0 22px!important}
  .num{font-size:40px!important}
  .art{display:none!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}">
<tr><td align="center" style="padding:28px 12px 44px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
    <tr><td style="padding:0 6px 18px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="left" valign="middle"><a href="https://designhouse.me" style="text-decoration:none"><img src="${origin}/mail/logo-dark.png" width="150" height="19" alt="Design House" style="display:block;border:0;font-family:${FONT};font-size:15px;font-weight:700;color:${C.ink}"></a></td>
        <td align="right" valign="middle" style="font-family:${FONT};font-size:16px;line-height:1;font-weight:500;letter-spacing:-0.01em;color:${C.ink}">Review<span style="font-weight:700;color:${C.orange}">Link</span></td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${C.line};border-radius:28px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td class="px" bgcolor="${C.wash}" style="background:${C.wash};background-image:linear-gradient(165deg,${C.wash} 0%,#fcefe6 52%,#ffffff 100%);border-radius:27px 27px 0 0;padding:34px 40px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" style="padding:0 0 26px">
              <div class="h1" style="font-family:${FONT};font-size:38px;line-height:1.06;font-weight:300;letter-spacing:-0.025em;color:${C.ink}">${title}</div>
              <div style="font-family:${FONT};font-size:16px;line-height:1.5;font-weight:500;color:${C.ink2};padding-top:12px">${lead}</div>
            </td>
            <td class="art" width="170" valign="bottom" align="right" style="padding:0"><img src="${origin}/mail/${image}.png" width="170" height="170" alt="" style="display:block;border:0"></td>
          </tr></table>
        </td></tr>
        <tr><td class="px" style="padding:30px 40px 38px">${body}</td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding:24px 28px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.ink3}">
      ${footer}<br>
      <a href="https://designhouse.me" style="color:${C.ink3};text-decoration:none">ReviewLink · narzędzie <b style="color:${C.ink2}">Design House</b></a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Klocki                                                               */
/* ------------------------------------------------------------------ */

function p(html) {
  return `<p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.ink2}">${html}</p>`;
}

function small(html) {
  return `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.ink3}">${html}</p>`;
}

function heading(text) {
  return `<div style="font-family:${FONT};font-size:13px;line-height:1;font-weight:600;color:${C.ink3};padding-bottom:14px">${text}</div>`;
}

function gap(px) {
  return `<div style="height:${px}px;line-height:${px}px;font-size:0">&nbsp;</div>`;
}

function hr() {
  return `<div style="height:1px;line-height:1px;font-size:0;background:${C.line}">&nbsp;</div>`;
}

function box(html, { bg = C.soft, pad = "20px 22px", accent = false } = {}) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="${bg}" style="background:${bg};border-radius:20px;padding:${pad};${accent ? `border-left:4px solid ${C.orange};` : ""}">${html}</td>
  </tr></table>`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="${C.orange}" style="background:${C.orange};border-radius:999px">
      <a href="${esc(href)}" style="display:inline-block;padding:17px 30px;font-family:${FONT};font-size:16px;line-height:1;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${label}&nbsp;&nbsp;&rsaquo;&rsaquo;</a>
    </td>
  </tr></table>`;
}

function starRow(n, size) {
  const cells = [1, 2, 3, 4, 5]
    .map((i) => {
      const on = i <= n;
      return `<td width="${size}" height="${size}" align="center" valign="middle" bgcolor="${on ? C.orange : C.soft}" style="background:${on ? C.orange : C.soft};border-radius:${Math.round(size * 0.29)}px;font-family:Arial,sans-serif;font-size:${Math.round(size * 0.5)}px;line-height:1;color:${on ? "#ffffff" : C.ink3}">★</td>${i < 5 ? `<td width="6" style="font-size:0">&nbsp;</td>` : ""}`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
}

function steps(items) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items
    .map(
      (t, i) => `<tr>
        <td width="34" valign="top" style="padding:0 0 16px"><div style="width:26px;height:26px;border-radius:13px;background:${C.orange};color:#ffffff;font-family:${FONT};font-size:13px;line-height:26px;font-weight:700;text-align:center">${i + 1}</div></td>
        <td valign="top" style="padding:3px 0 16px;font-family:${FONT};font-size:16px;line-height:1.5;color:${C.ink2}">${t}</td>
      </tr>`,
    )
    .join("")}</table>`;
}

function row(label, value) {
  return `<tr>
    <td width="90" valign="top" style="font-family:${FONT};font-size:14px;line-height:1.5;font-weight:600;color:${C.ink3};padding:4px 0">${label}</td>
    <td valign="top" style="font-family:${FONT};font-size:15px;line-height:1.5;color:${C.ink};padding:4px 0;word-break:break-word">${value}</td>
  </tr>`;
}

function bar(percent, color) {
  const w = Math.max(percent, 0);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    ${w ? `<td width="${w}%" height="10" bgcolor="${color}" style="background:${color};border-radius:5px;font-size:0;line-height:0">&nbsp;</td>` : ""}
    <td height="10" style="font-size:0;line-height:0">&nbsp;</td>
  </tr></table>`;
}

function legend() {
  const dot = (color, label) =>
    `<span style="display:inline-block;width:9px;height:9px;border-radius:5px;background:${color};vertical-align:middle"></span>&nbsp;<span style="vertical-align:middle">${label}</span>`;
  return `<div style="font-family:${FONT};font-size:12px;line-height:1.4;color:${C.ink3}">${dot(C.orange, "4–5★")}&nbsp;&nbsp;&nbsp;${dot(C.dark, "1–3★")}</div>`;
}

function lines(...items) {
  return items.filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
}

/** Polska liczba mnoga: 1 ocena, 2 oceny, 5 ocen, 22 oceny. */
export function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
