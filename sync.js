const https = require('https');
const fs = require('fs');
const path = require('path');

const email = process.env.TGMASTER_EMAIL;
const password = process.env.TGMASTER_PASSWORD;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!email || !password) {
  console.error('Identifiants TGMASTER_EMAIL / TGMASTER_PASSWORD manquants dans l\'environnement.');
  process.exit(1);
}

function mergeCookies(oldCookies, setCookieHeaders) {
  const cookieMap = {};
  if (oldCookies) {
    oldCookies.split(';').forEach(c => {
      const parts = c.trim().split('=');
      if (parts[0]) cookieMap[parts[0]] = parts.slice(1).join('=');
    });
  }
  if (setCookieHeaders) {
    const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    list.forEach(c => {
      const first = c.split(';')[0].trim();
      const parts = first.split('=');
      if (parts[0]) cookieMap[parts[0]] = parts.slice(1).join('=');
    });
  }
  return Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
}

function request(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOptions = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: options.method || (postData ? 'POST' : 'GET'),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36',
        'Referer': options.referer || 'https://app.tgmaster.com/student',
        ...(options.headers || {})
      }
    };
    if (postData) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
      reqOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const req = https.request(reqOptions, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function sendTelegram(text) {
  if (!botToken || !chatId) return Promise.resolve();
  return new Promise(resolve => {
    const postData = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
    const req = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: '/bot' + botToken + '/sendMessage',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', () => resolve());
    req.write(postData);
    req.end();
  });
}

const formatICSDate = (dateStr) => {
  const d = new Date(dateStr);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

async function run() {
  console.log('🔄 [CLOUD] Vérification du planning TgMaster...');
  const res1 = await request('https://app.tgmaster.com/login');
  let cookie = mergeCookies('', res1.headers['set-cookie']);
  const csrfMatch = res1.data.match(/name="_token"\s+value="([^"]+)"/i);
  if (!csrfMatch) {
    console.log('Page de login injoignable ou token CSRF absent.');
    return;
  }

  const postData = new URLSearchParams({ _token: csrfMatch[1], email, password }).toString();
  const res2 = await request('https://app.tgmaster.com/login', { method: 'POST', headers: { 'Cookie': cookie } }, postData);
  cookie = mergeCookies(cookie, res2.headers['set-cookie']);

  const res3 = await request('https://app.tgmaster.com/student', { headers: { 'Cookie': cookie } });
  cookie = mergeCookies(cookie, res3.headers['set-cookie']);

  const res4 = await request('https://app.tgmaster.com/student/planning', { headers: { 'Cookie': cookie } });
  if (res4.status !== 200) {
    console.log('Planning non disponible actuellement (Status HTTP:', res4.status, '). En attente de publication par l\'administration.');
    return;
  }

  let newEvents = [];
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(res4.data)) !== null) {
    const sc = match[1];
    if (sc.includes('new FullCalendar.Calendar') && sc.includes('events:')) {
      const evMatch = sc.match(/events\s*:\s*(\[[\s\S]*?\])\s*,\s*[a-zA-Z]/m) ||
                      sc.match(/events\s*:\s*(\[[\s\S]*?\])\s*\}\s*\)/m);
      if (evMatch) {
        try {
          newEvents = JSON.parse(evMatch[1]);
          break;
        } catch (e) {}
      }
    }
  }

  if (newEvents.length === 0) {
    console.log('Aucun nouveau cours détecté dans le planning.');
    return;
  }

  const eventsFile = path.join(__dirname, 'events.json');
  let oldEvents = [];
  if (fs.existsSync(eventsFile)) {
    try { oldEvents = JSON.parse(fs.readFileSync(eventsFile, 'utf8')); } catch {}
  }

  const oldIds = new Set(oldEvents.map(e => `${e.title}_${e.start}_${e.end}`));
  const addedEvents = newEvents.filter(e => !oldIds.has(`${e.title}_${e.start}_${e.end}`));

  console.log(`Événements : Anciens = ${oldEvents.length}, Nouveaux = ${newEvents.length}`);

  if (addedEvents.length > 0) {
    console.log(`🎉 ${addedEvents.length} nouveau(x) cours détecté(s) !`);
    let alertMsg = `🔔 *TgMaster : Nouveau Planning de la Semaine Détecté !*\n\n*Bachelor 2 Digital Management*\n\n`;
    addedEvents.slice(0, 6).forEach(ev => {
      const d = new Date(ev.start);
      alertMsg += `• *${ev.title}*\n  🗓️ ${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} de ${d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}\n`;
    });
    if (addedEvents.length > 6) alertMsg += `_... et ${addedEvents.length - 6} autres séances._\n`;
    alertMsg += '\n📲 Vos cours sont synchronisés en direct dans votre Google Agenda !';
    await sendTelegram(alertMsg);
  }

  fs.writeFileSync(eventsFile, JSON.stringify(newEvents, null, 2), 'utf8');

  // Génération ICS
  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TgMaster//Bachelor 2 Digital Management//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:TgMaster - Bachelor 2 Digital Management',
    'X-WR-TIMEZONE:Africa/Abidjan'
  ];

  newEvents.forEach((ev, idx) => {
    if (!ev.start || !ev.end) return;
    const dtStart = formatICSDate(ev.start);
    const dtEnd = formatICSDate(ev.end);
    const cleanDesc = (ev.description || '')
      .replace(/<br\s*[\/]?>/gi, '\\n')
      .replace(/<[^>]+>/g, '')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');

    ics.push('BEGIN:VEVENT');
    ics.push('UID:tgmaster-b2-' + idx + '-' + dtStart + '@tgmaster.com');
    ics.push('DTSTAMP:' + formatICSDate(new Date()));
    ics.push('DTSTART:' + dtStart);
    ics.push('DTEND:' + dtEnd);
    ics.push('SUMMARY:' + ev.title.replace(/,/g, '\\,'));
    if (cleanDesc) ics.push('DESCRIPTION:' + cleanDesc);
    ics.push('END:VEVENT');
  });
  ics.push('END:VCALENDAR');

  const icsFile = path.join(__dirname, 'tgmaster_emploi_du_temps.ics');
  fs.writeFileSync(icsFile, ics.join('\r\n'), 'utf8');
  console.log('✅ Fichier ICS et JSON mis à jour dans le Cloud avec succès.');
}

run().catch(console.error);
