CREATE TABLE IF NOT EXISTS departures (id BIGSERIAL PRIMARY KEY, date DATE NOT NULL, time TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 24 CHECK(capacity BETWEEN 1 AND 500), enabled BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE(date,time));
CREATE TABLE IF NOT EXISTS reservations (id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), departure_id BIGINT NOT NULL REFERENCES departures(id), package_id TEXT NOT NULL, people INTEGER NOT NULL CHECK(people BETWEEN 1 AND 20), name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', amount_grosz INTEGER NOT NULL, deposit_grosz INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('inquiry','pending','confirmed','cancelled','expired')), expires_at TIMESTAMPTZ, payment_reference TEXT UNIQUE, paid_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS reservations_departure_idx ON reservations(departure_id,status,expires_at);
CREATE TABLE IF NOT EXISTS email_outbox (id BIGSERIAL PRIMARY KEY, reservation_id UUID REFERENCES reservations(id), recipient TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, html TEXT NOT NULL, sent_at TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, UNIQUE(reservation_id,recipient,kind));

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS internal_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_order_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_per_departure ON reservations(departure_id) WHERE status='confirmed';
CREATE INDEX IF NOT EXISTS reservation_pending_departure ON reservations(departure_id,expires_at) WHERE status='pending';
