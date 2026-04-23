const fs = require('fs'), path = require('path'), axios = require('axios');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

(async () => {
  const log = await axios.post('https://api.opencaselist.com/v1/login', {
    username: process.env.OPENCASELIST_USER, password: process.env.OPENCASELIST_PASS, remember: true
  }, { timeout: 60000 });
  const cookie = (log.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const hdr = { headers: { Cookie: cookie }, timeout: 60000, validateStatus: () => true, maxRedirects: 5 };

  console.log('login ok');

  // Check a zip we KNOW used to exist
  const known = 'https://opencaselist.com/openev/hspolicy24-all-2025-05-06.zip';
  const h = await axios.head(known, hdr);
  console.log('known HEAD:', h.status, 'len=', h.headers['content-length'], 'ct=', h.headers['content-type']);

  // Directory listings / candidate URLs
  for (const u of [
    'https://opencaselist.com/openev',
    'https://opencaselist.com/openev/',
    'https://opencaselist.com/openev.php',
    'https://opencaselist.com/',
    'https://api.opencaselist.com/v1/openev',
    'https://api.opencaselist.com/v1/caselists/all',
    'https://api.opencaselist.com/v1/caselists?all=1',
    'https://api.opencaselist.com/v1/archives',
    'https://api.opencaselist.com/v1/caselists/hspolicy24',
    'https://api.opencaselist.com/v1/caselists/hsld24',
    'https://api.opencaselist.com/v1/caselists/hsld23',
  ]) {
    const r = await axios.get(u, hdr);
    const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    console.log(u, '→', r.status, 'bytes=', body.length);
    if (r.status === 200 && body.length < 2000) console.log('  body:', body.slice(0, 800));
  }
})().catch(e => console.error('err:', e.message));
