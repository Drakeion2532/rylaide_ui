// Tiny JSON-file store. Writes are debounced and atomic (write temp file, then rename).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = () => ({ users: [], groups: [], messages: [], rides: [], fuel: [], contacts: {} });

class Store {
  /** @param {string} file JSON file. @param {{remote?: import('./pg').PgBackend}} opts */
  constructor(file, { remote } = {}) {
    this.file = file;
    this.remote = remote || null;
    this.data = EMPTY();
    this.timer = null;
    this.rTimer = null;
    this.writing = null;   // promise of the database write in progress
    this.dirty = false;    // changed again while a write was running
    this.loaded = !remote; // never write to the database before it has been read
    this.closed = false;
    if (file && fs.existsSync(file)) {
      try {
        this.data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      } catch (e) {
        const bad = `${file}.corrupt-${Date.now()}`;
        fs.renameSync(file, bad);
        console.error(`Data file was unreadable; moved it to ${bad} and started fresh.`);
      }
    }
  }

  /**
   * Load from the database before serving. If the database can't be read we throw, so the server
   * doesn't start empty and then overwrite everyone's data.
   */
  async init() {
    if (!this.remote) return;
    await this.remote.setup();
    const saved = await this.remote.load();
    if (saved) {
      const next = { ...EMPTY(), ...saved };
      for (const k of Object.keys(next)) this.data[k] = next[k]; // keep the same object: the app holds a reference
    } else if (this.data.users.length) {
      await this.remote.write(JSON.stringify(this.data)); // first run: move the local file's data up
    }
    this.loaded = true;
  }

  save() {
    if (this.remote) { clearTimeout(this.rTimer); this.rTimer = setTimeout(() => this.push(), 800); }
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }

  /** Write to the database, one write at a time; changes made meanwhile go in the next write. */
  push() {
    if (!this.remote || !this.loaded) return Promise.resolve();
    clearTimeout(this.rTimer);
    if (this.writing) { this.dirty = true; return this.writing; }
    this.writing = this.remote.write(JSON.stringify(this.data))
      .catch((e) => {
        console.error('Saving to the database failed, retrying in 5 s:', e.message);
        if (!this.closed) { this.rTimer = setTimeout(() => this.push(), 5000); this.rTimer.unref?.(); }
      })
      .finally(() => { this.writing = null; if (this.dirty) { this.dirty = false; this.push(); } });
    return this.writing;
  }

  /** On shutdown: write everything that's pending. */
  async close() {
    this.flush();
    if (!this.remote) return;
    clearTimeout(this.rTimer);
    while (this.writing) await this.writing;
    this.closed = true;
    await this.push();
    clearTimeout(this.rTimer);
    await this.remote.end();
  }

  flush() {
    if (!this.file) return;
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

const id = () => crypto.randomBytes(9).toString('base64url');
const token = () => crypto.randomBytes(24).toString('base64url');
// Group codes avoid look-alike characters (0/O, 1/I/L) so they're easy to read out on the road.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const code = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

module.exports = { Store, id, token, code };
