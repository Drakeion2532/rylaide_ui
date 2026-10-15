// Tiny JSON-file store. Writes are debounced and atomic (write temp file, then rename).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = () => ({ users: [], groups: [], messages: [], rides: [], fuel: [], contacts: {} });

class Store {
  constructor(file) {
    this.file = file;
    this.data = EMPTY();
    this.timer = null;
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

  save() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
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
