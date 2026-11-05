// Funzioni condivise per il conteggio di visite e clic della landing.
// I dati stanno in un database Redis (Upstash) collegato al progetto Vercel:
// se le variabili d'ambiente non ci sono, il conteggio resta spento e la pagina funziona lo stesso.

const crypto = require('crypto');

const TZ = 'Europe/Rome';

// Giorno (AAAA-MM-GG) nel fuso di Roma.
function dayKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function addDays(key, n) {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function redisConf() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function pipeline(commands) {
  const conf = redisConf();
  if (!conf) throw Object.assign(new Error('Archivio dati non collegato'), { code: 'NO_STORE' });
  const res = await fetch(conf.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + conf.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error('Redis ' + res.status);
  const out = await res.json();
  return out.map((item) => {
    if (item.error) throw new Error(item.error);
    return item.result;
  });
}

// Browser automatici e programmi di anteprima: non sono visitatori.
const AUTOMATED = /bot|crawl|spider|slurp|headless|lighthouse|phantom|playwright|puppeteer|selenium|electron|claude|anthropic|curl|wget|python|node-fetch|axios|facebookexternalhit|vercel|monitor|uptime|preview/i;

function isAutomated(req) {
  return AUTOMATED.test(String(req.headers['user-agent'] || ''));
}

// Si conta solo l'indirizzo di produzione (le anteprime e localhost no).
function hostAllowed(req) {
  if (process.env.TRACK_ANY_HOST === '1') return true;
  const allowed = (process.env.STATS_HOSTS || 'artecristiana-landing.vercel.app')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return allowed.indexOf(host) !== -1;
}

// Solo i link della landing: evita che qualcuno gonfi i numeri con indirizzi inventati.
function linkAllowed(url) {
  return typeof url === 'string' && url.length <= 300 &&
    (url.indexOf('https://www.artecristiana.it/') === 0 || url === 'mailto:redazione@artecristiana.it');
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    raw = Buffer.concat(chunks).toString('utf8');
  }
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function sameKey(given, expected) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { dayKey, addDays, pipeline, redisConf, isAutomated, hostAllowed, linkAllowed, readJson, sameKey };
