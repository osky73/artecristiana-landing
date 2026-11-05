// Registra una visita ("v") o un clic ("c") sulla landing.
const { dayKey, pipeline, redisConf, isAutomated, hostAllowed, linkAllowed, readJson } = require('./_lib');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  // Sempre 204: il visitatore non deve accorgersi di nulla, nemmeno se il conteggio non parte.
  res.statusCode = 204;
  try {
    if (!redisConf() || !hostAllowed(req) || isAutomated(req)) return res.end();
    const body = await readJson(req);
    const day = dayKey(new Date());
    if (body.t === 'v') {
      await pipeline([['HINCRBY', 's:' + day, 'v', 1]]);
    } else if (body.t === 'c' && linkAllowed(body.u)) {
      const label = String(body.l || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const commands = [
        ['HINCRBY', 's:' + day, 'c', 1],
        ['HINCRBY', 'k:' + day, body.u, 1],
      ];
      if (label) commands.push(['HSET', 'labels', body.u, label]);
      await pipeline(commands);
    }
  } catch (err) {
    console.error('track', err && err.message);
  }
  return res.end();
};
