// Postgres persistence for free hosting (e.g. Render free + Neon free), where the server's own disk
// is wiped on every restart. The whole app state is one JSON row; bike photos are rows of bytes.
// Enabled by DATABASE_URL. Without it, the JSON file (DATA_FILE) and photo folder are used as before.
const { Pool } = require('pg');

class PgBackend {
  constructor(url) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    // Neon and most hosts need TLS. `sslmode` in the URL wins if present.
    this.pool = new Pool({
      connectionString: url,
      ssl: local || /sslmode=/.test(url) ? undefined : { rejectUnauthorized: true },
      max: 3,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 20_000, // a sleeping free database can take a few seconds to wake
    });
    this.pool.on('error', (e) => console.error('Database connection dropped:', e.message));
  }

  async setup() {
    await this.pool.query(`create table if not exists rylaide_state (
      id int primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    await this.pool.query(`create table if not exists rylaide_photos (
      id text primary key, data bytea not null, created_at timestamptz not null default now())`);
  }

  async load() {
    const r = await this.pool.query('select data from rylaide_state where id = 1');
    return r.rows[0]?.data || null;
  }

  async write(json) {
    await this.pool.query(
      `insert into rylaide_state (id, data, updated_at) values (1, $1::jsonb, now())
       on conflict (id) do update set data = excluded.data, updated_at = now()`, [json]);
  }

  async putPhoto(id, buf) { await this.pool.query('insert into rylaide_photos (id, data) values ($1, $2) on conflict (id) do update set data = excluded.data', [id, buf]); }
  async getPhoto(id) { const r = await this.pool.query('select data from rylaide_photos where id = $1', [id]); return r.rows[0]?.data || null; }
  async delPhoto(id) { await this.pool.query('delete from rylaide_photos where id = $1', [id]); }

  end() { return this.pool.end(); }
}

module.exports = { PgBackend };
