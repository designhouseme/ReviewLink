-- Jeden adres e-mail = jeden stały link. Edycja zmienia dane, nie adres.
CREATE TABLE links (
  id           TEXT PRIMARY KEY,              -- krótki ID w adresie /o/:id
  email        TEXT NOT NULL UNIQUE,          -- zweryfikowany kodem, małymi literami
  name         TEXT NOT NULL,                 -- nazwa firmy pokazywana klientom
  google_url   TEXT NOT NULL,                 -- tylko domeny Google (sprawdzane przy zapisie i przy wyświetleniu)
  feedback_url TEXT,                          -- NULL = uwagi przychodzą mailem
  disabled     INTEGER NOT NULL DEFAULT 0,    -- do wyłączenia linku, którego ktoś nadużywa
  marketing    INTEGER NOT NULL DEFAULT 0,    -- zgoda na kontakt handlowy
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Jednorazowe kody z maila. Trzymamy tylko hash.
CREATE TABLE codes (
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  ip_hash    TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX codes_email ON codes (email, created_at);
CREATE INDEX codes_ip ON codes (ip_hash, created_at);

-- Sesja po wpisaniu kodu. Token tylko jako hash.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Zdarzenia ze strony oceny: view, rate (stars), google, feedback.
-- Treści uwag tu nie ma - idą mailem i nie zostają u nas.
CREATE TABLE events (
  link_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  stars      INTEGER,
  ip_hash    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX events_link ON events (link_id, created_at);
CREATE INDEX events_ip ON events (ip_hash, link_id, created_at);
