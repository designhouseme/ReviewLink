/**
 * Walidacja linków wpisywanych w generatorze. Ten sam plik importuje Worker
 * (przy zapisie i przy wyświetlaniu strony oceny) i przeglądarka (podpowiedzi
 * na żywo), więc reguły są w jednym miejscu.
 *
 * Link Google przechodzi tylko z domen Google - strona oceny nigdy nie
 * przekieruje klienta gdzie indziej, nawet gdyby ktoś podmienił dane w bazie.
 */

const MAPS_HOSTS = ["www.google.com", "google.com", "maps.google.com", "www.google.pl", "google.pl"];

/**
 * @returns {{ url: string, kind: "review" | "profile" } | { error: string }}
 * `review` otwiera od razu okno pisania opinii, `profile` tylko wizytówkę.
 */
export function normalizeGoogleUrl(input) {
  let raw = String(input ?? "").trim();
  if (!raw) return { error: "Wklej link do opinii z Google." };
  if (raw.length > 1000) return { error: "Ten link jest za długi. Skopiuj krótki link z „Poproś o opinie”." };
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: "To nie wygląda na link." };
  }
  const host = url.hostname.toLowerCase();

  if (host === "g.page") {
    const review = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{6,80})(?:\/|$)/);
    if (review) return { url: `https://g.page/r/${review[1]}/review`, kind: "review" };
    const named = url.pathname.match(/^\/([A-Za-z0-9_-]{2,80})(?:\/review)?\/?$/);
    if (named) return { url: `https://g.page/${named[1]}/review`, kind: "review" };
  }

  if (host === "search.google.com" && url.pathname.startsWith("/local/writereview")) {
    const placeId = url.searchParams.get("placeid") ?? "";
    if (/^[A-Za-z0-9_-]{10,120}$/.test(placeId)) {
      return { url: `https://search.google.com/local/writereview?placeid=${placeId}`, kind: "review" };
    }
  }

  if ((host === "maps.app.goo.gl" || host === "goo.gl") && /^\/[A-Za-z0-9_/-]{4,80}$/.test(url.pathname)) {
    return { url: `https://${host}${url.pathname}`, kind: "profile" };
  }

  if (MAPS_HOSTS.includes(host) && url.pathname.startsWith("/maps")) {
    return { url: `https://${host}${url.pathname}${url.search}`, kind: "profile" };
  }

  return { error: "To nie jest link z Google. Skopiuj go z przycisku „Poproś o opinie” w Profilu Firmy." };
}

/** Strona firmy, na którą klient może przejść z uwagami. Tylko https. */
export function normalizeSiteUrl(input) {
  let raw = String(input ?? "").trim();
  if (!raw) return { error: "Wklej adres strony z formularzem." };
  if (raw.length > 500) return { error: "Ten adres jest za długi." };
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: "To nie wygląda na adres strony." };
  }
  if (url.protocol !== "https:") url.protocol = "https:";
  if (url.username || url.password || !/\.[a-z]{2,}$/i.test(url.hostname)) {
    return { error: "To nie wygląda na adres strony." };
  }
  return { url: url.href, host: url.hostname.replace(/^www\./, "") };
}

export function normalizeEmail(input) {
  const email = String(input ?? "").trim().toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}
