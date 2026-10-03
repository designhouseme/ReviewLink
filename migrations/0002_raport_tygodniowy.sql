-- Cotygodniowy raport na e-mail. Domyślnie włączony; wypis jednym kliknięciem z maila
-- (/api/raport/wypisz) ustawia weekly = 0. report_week to poniedziałek ostatnio
-- wysłanego tygodnia (RRRR-MM-DD), żeby ponowny cron nie wysłał raportu drugi raz.
ALTER TABLE links ADD COLUMN weekly INTEGER NOT NULL DEFAULT 1;
ALTER TABLE links ADD COLUMN report_week TEXT;
