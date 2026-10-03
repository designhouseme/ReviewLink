# Link do opinii · Design House

Darmowe narzędzie dla małych firm. Firma dostaje jeden stały link, który wysyła klientom po zleceniu. Klient wybiera gwiazdki:

- **4–5**: przycisk prowadzi do okna opinii w Google (nowa karta), a na stronie zostaje podziękowanie;
- **1–3**: najpierw pole na wiadomość do firmy (wysyłamy ją mailem i nie zapisujemy) albo przejście na stronę firmy. Pod spodem jest mniejszy link do publicznej opinii w Google.

Konta nie ma. Firma potwierdza adres e-mail jednorazowym kodem, a ten sam kod służy później do logowania. Jeden adres e-mail = jeden link. Edycja zmienia dane, ale nie adres linku.

## Uruchomienie lokalne

```bash
npm install
cp .dev.vars.example .dev.vars   # DEV_SHOW_CODE=1: kod pokazuje się na stronie
npm run db:local                 # migracje D1 (lokalny SQLite w .wrangler/)
npm run db:seed                  # przykładowe linki: /o/demo123 i /o/demourl
npm run dev                      # http://localhost:8790
```

Maile lokalnie są tylko symulowane. Wrangler wypisuje w konsoli ścieżkę do pliku `.txt` lub `.html` z treścią.

## Struktura

| Plik | Co robi |
|---|---|
| `src/worker.js` | API (`/api/*`) i strona oceny `/o/:id` (szablon + dane przez HTMLRewriter) |
| `migrations/0001_init.sql` | `links`, `codes`, `sessions`, `events` |
| `public/index.html` + `assets/app.js` | generator: start → firma → uwagi → e-mail z kodem → panel |
| `public/ocena.html` + `assets/ocena.js` | strona dla klienta firmy; `?podglad=1` to podgląd w generatorze |
| `public/assets/links.js` | walidacja linków, wspólna dla Workera i przeglądarki |
| `public/assets/base.css` | tokeny i wspólne komponenty |
| `public/img/*.webp` | ilustracje (Codex); źródła PNG w `design/zrodla/` |

## Zabezpieczenia

- Strona oceny przekierowuje tylko do domen Google. Link jest sprawdzany przy zapisie i jeszcze raz przy każdym wyświetleniu. Na stronę firmy nie przekierowujemy automatycznie: klient widzi przycisk z adresem.
- Kody: 6 cyfr, ważne 15 minut, najwyżej 5 prób; w bazie leży tylko hash. Limity wysyłki: 3 kody na godzinę na adres e-mail i 10 na IP.
- Uwagi od klientów: najwyżej 3 na godzinę z jednego IP na link i 40 na dobę na link. Formularz ma ukryte pole na boty.
- Turnstile włącza się sam, gdy ustawione są `TURNSTILE_SITE_KEY` i `TURNSTILE_SECRET`.
- Nazwa firmy w szablonie: tekst escapuje HTMLRewriter, a w JSON każdy `<` jest zamieniany na `<`.

## Przed wdrożeniem (do zrobienia)

1. **Email Sending:** sprawdzić, czy na koncie da się wysyłać maile na dowolny adres, a nie tylko na zweryfikowane. Kody i uwagi idą do firm. Nadawca jest ustawiony w `MAIL_FROM`.
2. **D1:** pierwszy `wrangler deploy` założy bazę sam. Potem: `npx wrangler d1 migrations apply dh-opinie --remote`.
3. **Sekrety:** `npx wrangler secret put HASH_PEPPER`, a dla Turnstile `TURNSTILE_SECRET` (sekret) i `TURNSTILE_SITE_KEY` (zmienna).
4. **Domena:** subdomena (np. `opinie.designhouse.me`) albo osobna krótka domena. Ta druga daje krótsze linki i oddziela reputację od designhouse.me. Ustawić `PUBLIC_ORIGIN` i dodać trasę w `wrangler.jsonc`.
5. **`DEV_SHOW_CODE`:** tylko w `.dev.vars`, nigdy w `vars` ani w sekretach na produkcji.
6. **Sprzątanie:** wygasłe sesje usuwa logowanie, ale stare `codes` i `events` warto czyścić cronem.
7. **Nagłówki bezpieczeństwa:** przy kopiowaniu `_headers` ze strony głównej trzeba zostawić `frame-ancestors 'self'` (nie `DENY`). Inaczej podgląd w ramce telefonu przestanie działać bez żadnego błędu.
8. **Fonty:** Urbanist ładuje się dziś z Google Fonts, także na stronie oceny dla klientów firm. Pod RODO lepiej trzymać go u siebie (licencja OFL, dwa pliki woff2).
9. **Statystyki:** dni na wykresie to kolejne 24 godziny wstecz od teraz, a nie dni kalendarzowe. Etykieta dnia tygodnia może się przesunąć o jeden w stosunku do daty kliknięcia.

## Do decyzji

**Mały link do Google przy 1–3 gwiazdkach.** Maciej opisał wersję, w której niezadowolony klient w ogóle nie widzi Google. Regulamin Google Business Profile zabrania jednak zniechęcania do negatywnych opinii i proszenia o opinie tylko zadowolonych klientów. Dlatego link jest, tylko mniejszy. Usunięcie to jeden element z atrybutem `data-soft-gate` w `public/ocena.html`. Ryzyko ponosi wtedy firma, której profil może stracić opinie.
