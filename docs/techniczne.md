# ReviewLink: dokumentacja techniczna

Cloudflare Workers + D1, bez frameworka i bez builda. Opis dla użytkowników jest w [README](../README.md).

## Link i kod QR

Jeden adres e-mail = jeden stały link (np. `/o/k3x9ab`). Zmiana danych nie zmienia adresu, więc wysłane wcześniej linki dalej działają. Na desktopie obok formularza jest telefon z podglądem na żywo, a na telefonie podgląd otwiera się przyciskiem z okiem.

**Kod QR** prowadzi do tego samego linku. Do pobrania są trzy formaty: PNG (1200 px), SVG (wektor do druku) i gotowa karta A6 w 300 dpi z nazwą firmy, gwiazdkami i kodem, do położenia na fakturze, wizytówce albo na aucie. Wszystko generuje się w przeglądarce ([`assets/qr.js`](../public/assets/qr.js), biblioteka [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT, w [`assets/vendor/`](../public/assets/vendor/)).

## Uruchomienie lokalne

```bash
npm install
cp .dev.vars.example .dev.vars   # DEV_SHOW_CODE=1: kod z maila pokazuje się na stronie
npm run db:local                 # migracje D1 (lokalny SQLite w .wrangler/)
npm run db:seed                  # przykładowe linki: /o/demo123 i /o/demourl
npm run dev                      # http://localhost:8790
```

Maile lokalnie są tylko symulowane. Wrangler wypisuje w konsoli ścieżkę do pliku z treścią.

## Wdrożenie

```bash
npm run deploy                                        # wrangler deploy
npx wrangler d1 migrations apply dh-opinie --remote   # po każdej nowej migracji
```

Na koncie są już: Worker `dh-opinie`, baza D1 `dh-opinie` (region EEUR) i sekret `HASH_PEPPER`.

## Jak to jest zbudowane

| Plik | Co robi |
|---|---|
| [`src/worker.js`](../src/worker.js) | API `/api/*` i strona oceny `/o/:id` (szablon i dane przez HTMLRewriter) |
| [`migrations/0001_init.sql`](../migrations/0001_init.sql) | tabele `links`, `codes`, `sessions`, `events` |
| [`public/index.html`](../public/index.html), [`assets/app.js`](../public/assets/app.js) | generator i panel firmy |
| [`public/ocena.html`](../public/ocena.html), [`assets/ocena.js`](../public/assets/ocena.js) | strona dla klienta; `?podglad=1` to podgląd w generatorze |
| [`public/assets/links.js`](../public/assets/links.js) | walidacja linków, wspólna dla Workera i przeglądarki |
| [`public/assets/base.css`](../public/assets/base.css) | tokeny i komponenty: pomarańczowa pigułka z ikoną, ciemny pasek kroków, karty |

API:

| Metoda i adres | Opis |
|---|---|
| `POST /api/code` | wysyła 6-cyfrowy kod na e-mail |
| `POST /api/verify` | sprawdza kod i zwraca token sesji (7 dni) oraz link, jeśli istnieje |
| `GET /api/link` · `PUT /api/link` | odczyt i zapis linku firmy (sesja), zapis tworzy albo aktualizuje link |
| `POST /api/o/:id/event` | statystyki: `view`, `rate`, `google` |
| `POST /api/o/:id/feedback` | wiadomość od klienta, wysyłana mailem do firmy |

## Zabezpieczenia

- **Tylko Google:** strona oceny przekierowuje wyłącznie do domen Google. Link jest sprawdzany przy zapisie i jeszcze raz przy każdym wyświetleniu. Na stronę firmy nie przekierowujemy automatycznie: klient widzi przycisk z adresem.
- **Kody:** 6 cyfr, ważne 15 minut, najwyżej 5 prób, w bazie tylko hash. Wysyłka: 3 kody na godzinę na adres e-mail i 10 na IP.
- **Uwagi od klientów:** najwyżej 3 na godzinę z jednego IP na link i 40 na dobę na link. Formularz ma ukryte pole na boty, a Turnstile włącza się po ustawieniu kluczy.
- **Nazwa firmy w szablonie:** tekst escapuje HTMLRewriter, a w JSON każdy `<` jest zamieniany na `<`.
- **Prywatność:** treści uwag nie zapisujemy, a adresy IP trzymamy tylko jako hash.

## Marka

Produkt nazywa się **ReviewLink** i występuje pod marką **Design House**. W interfejsie aplikacji wciąż jest dawna nazwa „Link do opinii”. Wordmark i znak (trzy kwadraty o stałym promieniu narożnika) pochodzą prosto z designhouse.me ([`public/brand/`](../public/brand/)), tak samo jak favicony i ikona dla iOS. Kolor interfejsu to pomarańcz `#ff6a2b` z referencji projektu.

Obrazki do podglądu linku w SMS-ie, na WhatsAppie i w social mediach: [`public/og.png`](../public/og.png) (generator) i [`public/og-ocena.png`](../public/og-ocena.png) (strona oceny; tytuł z nazwą firmy dopisuje Worker). Źródłem obu jest [`design/og.html`](../design/og.html): zrzut 1200×630 w Playwright z `?v=app` i `?v=ocena`. Maile mają prosty szablon w barwach Design House, bez obrazków.

## Grafiki

Ilustracje generuje Codex (`codex exec` z obrazem referencyjnym), wszystkie w jednym stylu: czarna kreska, czarne wypełnienia, pomarańczowe akcenty, przezroczyste tło. Zlecenia dla Codexa leżą w [`design/codex-*.md`](../design/), źródła PNG w [`design/zrodla/`](../design/zrodla/), a gotowe pliki WebP w [`public/img/`](../public/img/).

| Plik (`public/img/`) | Do czego |
|---|---|
| `hero-fachowiec` | start generatora |
| `dzieki-google`, `dzieki-wiadomosc` | podziękowania na stronie oceny |
| `kod-mail` | krok z kodem z maila |
| `blad-link` | nieaktywny link i 404 |
| `tlo-jasne` | tło panelu z telefonem (render 3D, kostki ze znaku DH) |
| `tlo-ciemne` | karta oferty w panelu; alternatywa dla tła podglądu |
| `fach-elektryk`, `fach-hydraulik`, `fach-ogrodnik`, `fach-mechanik`, `fach-fryzjerka`, `fach-sprzatanie` | zapas: warianty startu pod branże |
| `pusto-czekam`, `gotowe-link`, `edycja` | zapas: puste statystyki, świeżo utworzony link, edycja |
| `automat-sms`, `widget-strona`, `statystyki`, `kod-qr` | zapas: automatyczna wysyłka, widżet na stronę, statystyki, QR |

Nowe grafiki w tym samym stylu: wspólne zasady leżą w [`design/_styl.md`](../design/_styl.md), a uruchomienie to `codex exec -i design/1.png -i design/zrodla/hero-fachowiec.png - < design/codex-….md`.

## Przed startem na produkcji

1. **Domena (przed promowaniem kodów QR):** subdomena (np. `opinie.designhouse.me`) albo osobna krótka domena, która daje krótsze linki i oddziela reputację od designhouse.me. Wydrukowany kod QR ma adres zapisany na stałe, więc po zmianie domeny stary adres `*.workers.dev` musi dalej przekierowywać. Ustawić `PUBLIC_ORIGIN`, dodać trasę w `wrangler.jsonc` i podmienić absolutny adres `og:image` w `public/index.html`.
2. **Turnstile:** założyć widżet, potem `TURNSTILE_SECRET` (sekret) i `TURNSTILE_SITE_KEY` (zmienna).
3. **Maile:** sprawdzić na prawdziwym adresie spoza designhouse.me, że kod dochodzi. Nadawca jest ustawiony w `MAIL_FROM`.
4. **Fonty:** Urbanist ładuje się dziś z Google Fonts, także na stronie dla klientów firm. Pod RODO lepiej trzymać go u siebie (licencja OFL).
5. **Sprzątanie:** wygasłe sesje usuwa logowanie, ale stare `codes` i `events` warto czyścić cronem.
6. **Nagłówki:** przy dodawaniu `_headers` zostawić `frame-ancestors 'self'`, bo inaczej podgląd w ramce telefonu przestanie działać.
7. **`DEV_SHOW_CODE`:** tylko w `.dev.vars`, nigdy na produkcji.

Statystyki liczą dni jako kolejne 24 godziny wstecz od teraz, a nie dni kalendarzowe.

## Do decyzji

**Mały link do Google przy 1–3 gwiazdkach.** Pierwotny pomysł zakładał, że niezadowolony klient w ogóle nie widzi Google. Regulamin Google Business Profile zabrania jednak zniechęcania do negatywnych opinii i proszenia o opinie tylko zadowolonych klientów. Grozi to usunięciem opinii z profilu firmy. Dlatego link jest, tylko mniejszy. Usunięcie to jeden element z atrybutem `data-soft-gate` w [`public/ocena.html`](../public/ocena.html).
