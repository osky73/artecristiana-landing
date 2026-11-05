// Statistiche della landing: visualizzazioni, clic e primi 10 link, per periodo.
// Si legge solo con la chiave nella variabile STATS_KEY, che arriva da un link riservato.
const { dayKey, addDays, pipeline, redisConf, sameKey } = require('./_lib');

const MAX_DAYS = 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function pairs(flat) {
  const out = {};
  if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = Number(flat[i + 1]) || 0;
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Metodo non consentito' });
  const expected = process.env.STATS_KEY;
  if (!expected) return send(res, 503, { error: 'Statistiche non attive: manca la chiave (STATS_KEY).' });
  if (!sameKey(req.headers['x-stats-key'], expected)) return send(res, 401, { error: 'Chiave non valida.' });
  if (!redisConf()) return send(res, 503, { error: 'Statistiche non attive: archivio dati non collegato.' });

  const url = new URL(req.url, 'http://localhost');
  const today = dayKey(new Date());
  const range = url.searchParams.get('range') || '7';
  let from, to = today;
  if (range === 'today') from = today;
  else if (range === 'yesterday') { from = to = addDays(today, -1); }
  else if (range === 'custom') {
    from = url.searchParams.get('from');
    to = url.searchParams.get('to');
    if (!DATE.test(from || '') || !DATE.test(to || '') || from > to) return send(res, 400, { error: 'Periodo non valido.' });
    if (to > today) to = today;
  } else if (range === 'all') from = addDays(today, -(MAX_DAYS - 1));
  else from = addDays(today, -(Math.max(1, Math.min(parseInt(range, 10) || 7, MAX_DAYS)) - 1));

  const days = [];
  for (let d = from; d <= to && days.length < MAX_DAYS; d = addDays(d, 1)) days.push(d);

  try {
    const commands = [];
    days.forEach((d) => { commands.push(['HGETALL', 's:' + d]); commands.push(['HGETALL', 'k:' + d]); });
    const results = await pipeline(commands);

    let views = 0, clicks = 0;
    const perLink = {};
    const daily = [];
    days.forEach((d, i) => {
      const totals = pairs(results[i * 2]);
      const links = pairs(results[i * 2 + 1]);
      views += totals.v || 0;
      clicks += totals.c || 0;
      daily.push({ day: d, views: totals.v || 0, clicks: totals.c || 0 });
      Object.keys(links).forEach((u) => { perLink[u] = (perLink[u] || 0) + links[u]; });
    });

    const top = Object.keys(perLink).sort((a, b) => perLink[b] - perLink[a]).slice(0, 10);
    let labels = [];
    if (top.length) labels = (await pipeline([['HMGET', 'labels'].concat(top)]))[0] || [];

    return send(res, 200, {
      from, to, views, clicks, daily,
      top: top.map((u, i) => ({ url: u, label: labels[i] || u, clicks: perLink[u] })),
    });
  } catch (err) {
    console.error('stats', err && err.message);
    return send(res, 500, { error: 'Impossibile leggere i dati.' });
  }
};
