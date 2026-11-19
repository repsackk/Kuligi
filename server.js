
import express from 'express';
import 'dotenv/config';
import pg from 'pg';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: true }
        : undefined
    })
  : null;

const packages = {
  classic: { name: 'Kulig tradycyjny', price: 1200 },
  feast: { name: 'Kulig z biesiadą', price: 1800 },
  private: { name: 'Kulig premium na wyłączność', price: 2500 },
  romantic: { name: 'Kulig romantyczny 23:00', price: 3000 }
};

const slots = [
  '10:00', '12:30', '15:00',
  '17:30', '20:00', '23:00'
];

const MAX_GROUP = 20;
const SESSION_MS = 60 * 60 * 1000;
const COOKIE_NAME = 'kuligi_session';

const testMode =
  process.env.TEST_PAYMENTS === 'true' &&
  process.env.P24_ENABLED !== 'true';

const adminPath = '/' + (
  process.env.ADMIN_PATH || 'organizator-7f9a2'
).replace(/^\/+|\/+$/g, '');

const loginAttempts = new Map();
const testAttempts = new Map();

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

const currentTime = () =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date());

function validDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) return false;

  const date = new Date(value + 'T12:00:00Z');

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= today() &&
    date <= new Date(Date.now() + 180 * 86400000);
}

function needDb(req, res, next) {
  if (!pool) {
    return res.status(503).json({
      error: 'Baza danych nie jest skonfigurowana.'
    });
  }
  next();
}

// SESJE ADMINISTRATORA W POSTGRESQL

let sessionTableReady = null;

async function ensureSessionTable() {
  if (!pool) throw Error('Brak połączenia z bazą.');

  if (!sessionTableReady) {
    sessionTableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        csrf_token TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(err => {
      sessionTableReady = null;
      throw err;
    });
  }

  await sessionTableReady;
}

function parseCookies(req) {
  const result = {};

  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;

    result[part.slice(0, index).trim()] =
      part.slice(index + 1).trim();
  }

  return result;
}

function hashToken(token) {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/'
};

async function getSession(req) {
  if (req.adminSession) return req.adminSession;

  const token = parseCookies(req)[COOKIE_NAME];

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return null;
  }

  await ensureSessionTable();

  const tokenHash = hashToken(token);

  const { rows } = await pool.query(`
    SELECT token_hash, csrf_token, expires_at
    FROM admin_sessions
    WHERE token_hash = $1
      AND expires_at > NOW()
    LIMIT 1
  `, [tokenHash]);

  if (!rows.length) return null;

  req.adminSession = {
    hash: tokenHash,
    csrf: rows[0].csrf_token,
    expires: rows[0].expires_at
  };

  return req.adminSession;
}

async function auth(req, res, next) {
  try {
    const session = await getSession(req);

    if (!session) {
      return res.status(401).json({
        error: 'Sesja wygasła. Zaloguj się ponownie.'
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}

async function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  try {
    const session = await getSession(req);

    if (!session) {
      return res.status(401).json({
        error: 'Sesja wygasła.'
      });
    }

    const supplied = req.headers['x-csrf-token'] || '';
    const expected = session.csrf;

    const valid =
      typeof supplied === 'string' &&
      Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
      crypto.timingSafeEqual(
        Buffer.from(supplied),
        Buffer.from(expected)
      );

    if (!valid) {
      return res.status(403).json({
        error: 'Nieprawidłowy token CSRF.'
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}

// AUTOMATYCZNE TERMINY

async function ensureSchedule() {
  await pool.query(`
    INSERT INTO departures (date, time, capacity, enabled)
    SELECT days.day::date, times.time, 20, true
    FROM generate_series(
      (NOW() AT TIME ZONE 'Europe/Warsaw')::date,
      (NOW() AT TIME ZONE 'Europe/Warsaw')::date + 180,
      interval '1 day'
    ) AS days(day)
    CROSS JOIN (
      VALUES
        ('10:00'),
        ('12:30'),
        ('15:00'),
        ('17:30'),
        ('20:00'),
        ('23:00')
    ) AS times(time)
    ON CONFLICT (date, time) DO NOTHING
  `);
}

function validateBooking(body) {
  const {
    date, time, packageId,
    name, email, phone, consent
  } = body || {};

  const people = Number(body?.people);

  if (
    !validDate(date) ||
    !slots.includes(time) ||
    !packages[packageId] ||
    (time === '23:00') !== (packageId === 'romantic') ||
    !Number.isInteger(people) ||
    people < 1 ||
    people > MAX_GROUP ||
    typeof name !== 'string' ||
    name.trim().length < 3 ||
    name.length > 120 ||
    typeof email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 160 ||
    typeof phone !== 'string' ||
    phone.length < 7 ||
    phone.length > 30 ||
    consent !== true
  ) return false;

  if (date === today() && time <= currentTime()) {
    return false;
  }

  return true;
}

function limitTests(req, res, next) {
  if (!testMode) return next();

  const key = req.ip || 'unknown';
  const now = Date.now();

  let entry = testAttempts.get(key);

  if (!entry || entry.until <= now) {
    entry = { count: 0, until: now + 3600000 };
  }

  if (entry.count >= 5) {
    return res.status(429).json({
      error: 'Limit 5 rezerwacji testowych na godzinę.'
    });
  }

  entry.count++;
  testAttempts.set(key, entry);
  next();
}

// PANEL ADMINISTRATORA

app.get('/admin.html', (req, res) => {
  res.sendStatus(404);
});

app.get(adminPath, (req, res) => {
  res.sendFile(path.join(ROOT, 'private', 'panel.html'));
});

// LOGOWANIE — COOKIE NA 1 GODZINĘ

app.post('/api/admin/login', needDb, async (req, res, next) => {
  try {
    const key = req.ip || 'unknown';
    const now = Date.now();

    const attempt = loginAttempts.get(key) || {
      count: 0,
      until: 0
    };

    if (attempt.until > now) {
      return res.status(429).json({
        error: 'Za dużo prób. Spróbuj za 15 minut.'
      });
    }

    const expected = process.env.ADMIN_PASSWORD || '';
    const supplied = String(req.body?.password || '');

    const valid =
      expected.length >= 16 &&
      Buffer.byteLength(expected) === Buffer.byteLength(supplied) &&
      crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(supplied)
      );

    if (!valid) {
      attempt.count++;

      if (attempt.count >= 5) {
        attempt.count = 0;
        attempt.until = now + 900000;
      }

      loginAttempts.set(key, attempt);

      return res.status(401).json({
        error: 'Nieprawidłowe hasło.'
      });
    }

    loginAttempts.delete(key);

    await ensureSessionTable();

    const token = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashToken(token);

    await pool.query(`
      INSERT INTO admin_sessions (
        token_hash,
        csrf_token,
        expires_at
      )
      VALUES (
        $1,
        $2,
        NOW() + INTERVAL '1 hour'
      )
    `, [tokenHash, csrfToken]);

    res.cookie(COOKIE_NAME, token, {
      ...cookieOptions,
      maxAge: SESSION_MS
    });

    res.json({
      ok: true,
      csrf: csrfToken,
      expiresIn: 3600
    });

  } catch (err) {
    next(err);
  }
});

// SPRAWDZENIE SESJI PO F5

app.get('/api/admin/session', needDb, auth, async (req, res) => {
  res.json({
    ok: true,
    csrf: req.adminSession.csrf,
    expiresAt: req.adminSession.expires
  });
});

// WYLOGOWANIE — USUWA COOKIE I SESJĘ Z BAZY

app.post(
  '/api/admin/logout',
  needDb,
  auth,
  csrf,
  async (req, res, next) => {
    try {
      await pool.query(`
        DELETE FROM admin_sessions
        WHERE token_hash = $1
      `, [req.adminSession.hash]);

      res.clearCookie(COOKIE_NAME, cookieOptions);

      res.json({
        ok: true,
        message: 'Wylogowano.'
      });

    } catch (err) {
      next(err);
    }
  }
);

// ZABEZPIECZENIE WSZYSTKICH DALSZYCH API ADMINA

app.use('/api/admin', needDb, auth, csrf);

// STRONA PUBLICZNA

app.use(express.static(path.join(ROOT, 'public'), {
  index: 'index.html',
  dotfiles: 'deny'
}));

app.get('/api/config', (req, res) => {
  res.json({
    packages,
    slots,
    paymentsEnabled: false,
    testMode,
    depositPercent: 50,
    paymentProvider: 'przelewy24',
    databaseEnabled: !!pool
  });
});

// KALENDARZ — DOSTĘPNE DNI

app.get('/api/available-days', needDb, async (req, res, next) => {
  try {
    await ensureSchedule();

    const month = String(req.query.month || '');

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        error: 'Nieprawidłowy miesiąc.'
      });
    }

    const { rows } = await pool.query(`
      SELECT to_char(d.date, 'YYYY-MM-DD') AS date
      FROM departures d
      LEFT JOIN reservations r ON r.departure_id = d.id
      WHERE d.enabled = true
        AND d.date >= (NOW() AT TIME ZONE 'Europe/Warsaw')::date
        AND to_char(d.date, 'YYYY-MM') = $1
      GROUP BY d.id
      HAVING COALESCE(
        SUM(r.people) FILTER (
          WHERE r.status = 'confirmed'
          OR (
            r.status = 'pending'
            AND r.expires_at > NOW()
          )
        ), 0
      ) = 0
      ORDER BY d.date
    `, [month]);

    res.json({
      days: [...new Set(rows.map(r => r.date))]
    });

  } catch (err) {
    next(err);
  }
});

// KALENDARZ — DOSTĘPNE GODZINY

app.get('/api/availability', needDb, async (req, res, next) => {
  try {
    await ensureSchedule();

    const date = String(req.query.date || '');

    if (!validDate(date)) {
      return res.status(400).json({
        error: 'Nieprawidłowa data.'
      });
    }

    const { rows } = await pool.query(`
      SELECT
        d.time,
        d.capacity,
        d.enabled,
        COALESCE(
          SUM(r.people) FILTER (
            WHERE r.status = 'confirmed'
            OR (
              r.status = 'pending'
              AND r.expires_at > NOW()
            )
          ), 0
        )::int AS taken
      FROM departures d
      LEFT JOIN reservations r ON r.departure_id = d.id
      WHERE d.date = $1
      GROUP BY d.id
      ORDER BY d.time
    `, [date]);

    const indexed = new Map(
      rows.map(row => [row.time, row])
    );

    res.json({
      date,
      slots: slots.map(time => {
        const row = indexed.get(time);

        return {
          time,
          romantic: time === '23:00',
          available: !!(
            row &&
            row.enabled &&
            row.taken === 0 &&
            !(date === today() && time <= currentTime())
          )
        };
      })
    });

  } catch (err) {
    next(err);
  }
});

// REZERWACJE TESTOWE — BEZ HASŁA I PŁATNOŚCI

app.post(
  '/api/bookings',
  limitTests,
  needDb,
  async (req, res, next) => {
    if (!testMode) {
      return res.status(503).json({
        error: 'Rezerwacje są chwilowo niedostępne.'
      });
    }

    if (!validateBooking(req.body)) {
      return res.status(400).json({
        error: 'Sprawdź dane formularza.'
      });
    }

    const {
      date, time, packageId,
      name, email, phone, notes
    } = req.body;

    const people = Number(req.body.people);
    let client;

    try {
      await ensureSchedule();

      client = await pool.connect();
      await client.query('BEGIN');

      const departure = await client.query(`
        SELECT *
        FROM departures
        WHERE date = $1
          AND time = $2
          AND enabled = true
        FOR UPDATE
      `, [date, time]);

      if (!departure.rowCount) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error: 'Termin jest niedostępny.'
        });
      }

      const d = departure.rows[0];

      const existing = await client.query(`
        SELECT 1
        FROM reservations
        WHERE departure_id = $1
          AND (
            status = 'confirmed'
            OR (
              status = 'pending'
              AND expires_at > NOW()
            )
          )
        LIMIT 1
      `, [d.id]);

      if (existing.rowCount) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error: 'Ten kulig jest już zarezerwowany.'
        });
      }

      if (people > Math.min(d.capacity, MAX_GROUP)) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          error: 'Grupa przekracza limit uczestników.'
        });
      }

      const id = crypto.randomUUID();
      const amount = packages[packageId].price * 100;
      const deposit = amount / 2;

      await client.query(`
        INSERT INTO reservations (
          id,
          departure_id,
          package_id,
          people,
          name,
          email,
          phone,
          notes,
          amount_grosz,
          deposit_grosz,
          status,
          expires_at,
          payment_reference,
          paid_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          'confirmed',NULL,$11,NULL
        )
      `, [
        id,
        d.id,
        packageId,
        people,
        name.trim(),
        email.trim(),
        phone.trim(),
        String(notes || '').slice(0, 500),
        amount,
        deposit,
        'TEST-' + id
      ]);

      await client.query('COMMIT');

      res.status(201).json({
        ok: true,
        id,
        status: 'confirmed',
        test: true,
        amount: amount / 100,
        depositAmount: deposit / 100
      });

    } catch (err) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }

      next(err);

    } finally {
      if (client) client.release();
    }
  }
);

// PANEL — REZERWACJE

app.get('/api/admin/bookings', needDb, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        r.*,
        to_char(d.date, 'YYYY-MM-DD') AS date,
        d.time
      FROM reservations r
      JOIN departures d ON d.id = r.departure_id
      WHERE r.status = 'confirmed'
        AND d.date >= (NOW() AT TIME ZONE 'Europe/Warsaw')::date
      ORDER BY d.date, d.time
      LIMIT 500
    `);

    res.json(rows.map(r => ({
      ...r,
      packageId: r.package_id,
      amount: r.amount_grosz / 100,
      depositAmount: r.deposit_grosz / 100,
      test: String(r.payment_reference || '').startsWith('TEST-')
    })));

  } catch (err) {
    next(err);
  }
});

// PANEL — TERMINY

app.get('/api/admin/departures', needDb, async (req, res, next) => {
  try {
    await ensureSchedule();

    const { rows } = await pool.query(`
      SELECT
        d.id,
        to_char(d.date, 'YYYY-MM-DD') AS date,
        d.time,
        d.capacity,
        d.enabled,
        COALESCE(
          SUM(r.people) FILTER (
            WHERE r.status = 'confirmed'
            OR (
              r.status = 'pending'
              AND r.expires_at > NOW()
            )
          ), 0
        )::int AS taken
      FROM departures d
      LEFT JOIN reservations r ON r.departure_id = d.id
      WHERE d.date >= CURRENT_DATE
      GROUP BY d.id
      ORDER BY d.date, d.time
      LIMIT 500
    `);

    res.json(rows);

  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/departures', needDb, async (req, res, next) => {
  try {
    const { date, time, capacity } = req.body || {};
    const cap = Number(capacity);

    if (
      !validDate(date) ||
      !slots.includes(time) ||
      !Number.isInteger(cap) ||
      cap < 1 ||
      cap > 500
    ) {
      return res.status(400).json({
        error: 'Nieprawidłowe dane terminu.'
      });
    }

    const { rows } = await pool.query(`
      INSERT INTO departures (date, time, capacity)
      VALUES ($1, $2, $3)
      ON CONFLICT (date, time)
      DO UPDATE SET
        capacity = EXCLUDED.capacity,
        enabled = true
      RETURNING id
    `, [date, time, cap]);

    res.json(rows[0]);

  } catch (err) {
    next(err);
  }
});

app.patch(
  '/api/admin/departures/:id',
  needDb,
  async (req, res, next) => {
    try {
      if (typeof req.body?.enabled !== 'boolean') {
        return res.sendStatus(400);
      }

      const result = await pool.query(
        'UPDATE departures SET enabled=$1 WHERE id=$2',
        [req.body.enabled, req.params.id]
      );

      res.sendStatus(result.rowCount ? 204 : 404);

    } catch (err) {
      next(err);
    }
  }
);

// PANEL — ANULOWANIE REZERWACJI

app.patch(
  '/api/admin/bookings/:id',
  needDb,
  async (req, res, next) => {
    try {
      if (req.body?.status !== 'cancelled') {
        return res.status(400).json({
          error: 'Można tylko anulować rezerwację.'
        });
      }

      const result = await pool.query(`
        UPDATE reservations
        SET status = 'cancelled'
        WHERE id = $1
          AND status IN ('inquiry', 'confirmed')
        RETURNING id
      `, [req.params.id]);

      res.sendStatus(result.rowCount ? 204 : 409);

    } catch (err) {
      next(err);
    }
  }
);

// PANEL — NOTATKI

app.patch(
  '/api/admin/bookings/:id/notes',
  needDb,
  async (req, res, next) => {
    try {
      const notes = req.body?.internalNotes;

      if (typeof notes !== 'string' || notes.length > 2000) {
        return res.status(400).json({
          error: 'Notatka jest za długa.'
        });
      }

      const result = await pool.query(`
        UPDATE reservations
        SET internal_notes = $1
        WHERE id = $2
        RETURNING id
      `, [notes, req.params.id]);

      res.sendStatus(result.rowCount ? 204 : 404);

    } catch (err) {
      next(err);
    }
  }
);

// PANEL — WIADOMOŚCI EMAIL

app.get('/api/admin/emails', needDb, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id, recipient, kind, subject,
        sent_at, attempts, last_error
      FROM email_outbox
      ORDER BY id DESC
      LIMIT 100
    `);

    res.json(rows);

  } catch (err) {
    next(err);
  }
});

// CZYSZCZENIE WYGASŁYCH SESJI

setInterval(async () => {
  const now = Date.now();

  for (const [key, value] of loginAttempts) {
    if (value.until && value.until < now) {
      loginAttempts.delete(key);
    }
  }

  for (const [key, value] of testAttempts) {
    if (value.until < now) {
      testAttempts.delete(key);
    }
  }

  if (pool) {
    try {
      await ensureSessionTable();

      await pool.query(`
        DELETE FROM admin_sessions
        WHERE expires_at <= NOW()
      `);
    } catch (err) {
      console.error('Czyszczenie sesji:', err.message);
    }
  }
}, 600000).unref();

// BŁĘDY

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    error: 'Błąd serwera. Sprawdź Render Logs.'
  });
});

app.listen(PORT, () => {
  console.log(
    `Kuligi na porcie ${PORT} | DB: ${pool ? 'OK' : 'BRAK'} | TEST: ${testMode}`
  );
});
