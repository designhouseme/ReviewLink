-- Przykładowy link do lokalnych testów: http://localhost:8790/o/demo123
INSERT OR REPLACE INTO links (id, email, name, google_url, feedback_url, disabled, marketing, created_at, updated_at)
VALUES ('demo123', 'mirec@example.com', 'MIREC Usługi Remontowe', 'https://g.page/r/CZx8f3l9pQ2yEBM/review', NULL, 0, 0,
        strftime('%s','now') * 1000, strftime('%s','now') * 1000);

INSERT OR REPLACE INTO links (id, email, name, google_url, feedback_url, disabled, marketing, created_at, updated_at)
VALUES ('demourl', 'hydro@example.com', 'Hydro-Serwis Kowalczyk', 'https://g.page/r/CQ2abcDEF12345/review', 'https://hydro-serwis.example.pl/kontakt', 0, 0,
        strftime('%s','now') * 1000, strftime('%s','now') * 1000);

-- Zdarzenia z ostatnich 14 dni dla demo123, żeby raport tygodniowy miał co liczyć:
-- npm run dev -- --test-scheduled, potem curl "http://localhost:8790/cdn-cgi/handler/scheduled?cron=0+6+*+*+1"
DELETE FROM events WHERE link_id = 'demo123' AND ip_hash = 'seed';
WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 89)
INSERT INTO events (link_id, kind, stars, ip_hash, created_at)
SELECT 'demo123',
       CASE WHEN i % 3 = 0 THEN 'view' WHEN i % 3 = 1 THEN 'rate' WHEN i % 7 = 2 THEN 'feedback' ELSE 'google' END,
       CASE WHEN i % 3 = 1 THEN (CASE WHEN i % 13 = 1 THEN 2 WHEN i % 11 = 1 THEN 3 ELSE 5 - (i % 2) END) END,
       'seed',
       strftime('%s', 'now') * 1000 - i * 13 * 3600000
FROM n;
