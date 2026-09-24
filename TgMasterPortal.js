const https = require('https');
const fs = require('fs');
const path = require('path');

class TgMasterPortal {
  constructor(email, password) {
    this.email = email;
    this.password = password;
    this.cookie = '';
  }

  mergeCookies(setCookieHeaders) {
    const cookieMap = {};
    if (this.cookie) {
      this.cookie.split(';').forEach(c => {
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
    this.cookie = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  request(urlPath, options = {}, postData = null) {
    return new Promise((resolve, reject) => {
      const url = urlPath.startsWith('http') ? urlPath : `https://app.tgmaster.com${urlPath}`;
      const u = new URL(url);

      const reqOptions = {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: options.method || (postData ? 'POST' : 'GET'),
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36',
          'Referer': options.referer || 'https://app.tgmaster.com/student',
          'Cookie': this.cookie,
          ...(options.headers || {})
        }
      };

      if (postData) {
        reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
        reqOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }

      const req = https.request(reqOptions, res => {
        this.mergeCookies(res.headers['set-cookie']);
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  async ensureLogin() {
    // Tester si la session actuelle est valide
    if (this.cookie) {
      const testRes = await this.request('/student');
      if (testRes.status === 200 && testRes.data.includes('Espace étudiant')) {
        return; // Session encore valide
      }
    }

    console.log('[TgMasterPortal] Connexion en direct au portail TgMaster...');
    const loginPage = await this.request('/login');
    const csrfMatch = loginPage.data.match(/name="_token"\s+value="([^"]+)"/i);
    if (!csrfMatch) throw new Error('CSRF absent de la page de login');

    const postData = new URLSearchParams({
      _token: csrfMatch[1],
      email: this.email,
      password: this.password
    }).toString();

    const loginRes = await this.request('/login', { method: 'POST' }, postData);
    if (loginRes.status !== 302 && loginRes.status !== 200) {
      throw new Error(`Échec connexion HTTP: ${loginRes.status}`);
    }
  }

  // 1. Profil en direct
  async getLiveProfil() {
    await this.ensureLogin();
    const res = await this.request('/student/profil');
    const html = res.data;

    const extract = (regex) => {
      const m = html.match(regex);
      return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
    };

    const cardMatch = html.match(/N° carte d[’']étudiant:\s*([^<\n\r]+)/i);
    const dobMatch = html.match(/Date de naissance:\s*([^<\n\r]+)/i);
    const cityMatch = html.match(/Ville de naissance:\s*([^<\n\r]+)/i);
    const phoneMatch = html.match(/Numéro de téléphone 1:\s*([^<\n\r]+)/i);
    const filiereMatch = html.match(/Filière:\s*([^<\n\r]+)/i);
    const nameMatch = html.match(/<h5 class="mb-0[^"]*">([^<]+)<\/h5>/i) || html.match(/Bienvenue\s+([A-Z\s-]+)/i);

    // Extraction des versements dans les tables
    const versements = [];
    const trMatches = html.match(/<tr>[\s\S]*?<\/tr>/gi) || [];
    trMatches.forEach(tr => {
      const clean = tr.replace(/<[^>]+>/g, '|').split('|').map(s => s.trim()).filter(Boolean);
      if (clean.length >= 3 && clean.some(c => c.includes('FCFA'))) {
        versements.push(clean.join(' — '));
      }
    });

    return {
      nom: nameMatch ? nameMatch[1].trim() : 'KOTCHI Antoine-Marie Epiphane',
      carte: cardMatch ? cardMatch[1].trim() : 'Non renseigné',
      dateNaissance: dobMatch ? dobMatch[1].trim() : 'Non renseigné',
      ville: cityMatch ? cityMatch[1].trim().replace(/&#039;/g, "'") : 'Non renseigné',
      telephone: phoneMatch ? phoneMatch[1].trim() : 'Non renseigné',
      filiere: filiereMatch ? filiereMatch[1].trim() : 'Digital Management',
      versements: versements
    };
  }

  // 2. Matières / Cours actuels en direct
  async getLiveCours() {
    await this.ensureLogin();
    const res = await this.request('/student/cours/current');
    const html = res.data;

    // Titre de la page
    const titleMatch = html.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i) || html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Cours de Bachelor 2';

    // Extraction des éléments de cours (cartes ou lignes de tableau)
    const cours = [];
    const cardMatches = html.match(/<div class="card-body">([\s\S]*?)<\/div>/gi) || [];
    cardMatches.forEach(c => {
      const txt = c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (txt.length > 5 && !txt.includes('Copyright') && !txt.includes('Accueil')) {
        cours.push(txt);
      }
    });

    return {
      titre: title,
      cours: cours
    };
  }

  // 3. Classes précédentes en direct
  async getLiveOldClasses() {
    await this.ensureLogin();
    const res = await this.request('/student/oldClasses');
    const html = res.data;

    const classes = [];
    const trMatches = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    trMatches.forEach(tr => {
      const clean = tr.replace(/<[^>]+>/g, '|').split('|').map(s => s.trim()).filter(Boolean);
      if (clean.length >= 4 && clean.some(c => c.includes('Bachelor'))) {
        classes.push(clean.join(' — '));
      }
    });

    return classes;
  }

  // 4. Certificats en direct
  async getLiveCertificats() {
    await this.ensureLogin();
    const res = await this.request('/student/certificats');
    const html = res.data;

    const certifs = [];
    const trMatches = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    trMatches.forEach(tr => {
      const clean = tr.replace(/<[^>]+>/g, '|').split('|').map(s => s.trim()).filter(Boolean);
      if (clean.length > 1 && !clean.includes('Nom du certificat')) {
        certifs.push(clean.join(' — '));
      }
    });

    return certifs;
  }

  // 5. Emploi du temps en direct
  async getLivePlanning() {
    await this.ensureLogin();
    const res = await this.request('/student/planning');
    if (res.status !== 200) {
      return { status: 'non_publie', events: [] };
    }

    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let events = [];
    while ((match = scriptRegex.exec(res.data)) !== null) {
      const sc = match[1];
      if (sc.includes('new FullCalendar.Calendar') && sc.includes('events:')) {
        const evMatch = sc.match(/events\s*:\s*(\[[\s\S]*?\])\s*,\s*[a-zA-Z]/m) ||
                        sc.match(/events\s*:\s*(\[[\s\S]*?\])\s*\}\s*\)/m);
        if (evMatch) {
          try {
            events = eval(evMatch[1]);
            break;
          } catch {}
        }
      }
    }

    return {
      status: events.length > 0 ? 'publie' : 'vide',
      events: events
    };
  }
}

module.exports = TgMasterPortal;
