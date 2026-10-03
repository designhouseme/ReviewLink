-- Przykładowy link do lokalnych testów: http://localhost:8790/o/demo123
INSERT OR REPLACE INTO links (id, email, name, google_url, feedback_url, disabled, marketing, created_at, updated_at)
VALUES ('demo123', 'mirec@example.com', 'MIREC Usługi Remontowe', 'https://g.page/r/CZx8f3l9pQ2yEBM/review', NULL, 0, 0,
        strftime('%s','now') * 1000, strftime('%s','now') * 1000);

INSERT OR REPLACE INTO links (id, email, name, google_url, feedback_url, disabled, marketing, created_at, updated_at)
VALUES ('demourl', 'hydro@example.com', 'Hydro-Serwis Kowalczyk', 'https://g.page/r/CQ2abcDEF12345/review', 'https://hydro-serwis.example.pl/kontakt', 0, 0,
        strftime('%s','now') * 1000, strftime('%s','now') * 1000);
