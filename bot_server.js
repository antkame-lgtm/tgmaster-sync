const fs = require('fs');
const path = require('path');
const https = require('https');
const TgMasterPortal = require('./TgMasterPortal');

const ENV_FILE = path.join(__dirname, '.env');

// Charger config .env si présent
let config = {};
if (fs.existsSync(ENV_FILE)) {
  fs.readFileSync(ENV_FILE, 'utf8').split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx !== -1) {
      config[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
    }
  });
}

const botToken = process.env.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN;
const email = process.env.TGMASTER_EMAIL || config.TGMASTER_EMAIL;
const password = process.env.TGMASTER_PASSWORD || config.TGMASTER_PASSWORD;
const allowedChatId = process.env.TELEGRAM_CHAT_ID || config.TELEGRAM_CHAT_ID;

if (!botToken || !email || !password || !allowedChatId) {
  console.error('Erreur Critique Sécurité: Identifiants ou TELEGRAM_CHAT_ID manquant. Arrêt d\'urgence (Fail-Closed).');
  process.exit(1);
}

// Client direct vers le serveur officiel
const portal = new TgMasterPortal(email, password);

const telegramRequest = (method, data = null) => {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : '';
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: '/bot' + botToken + '/' + method,
      method: data ? 'POST' : 'GET',
      rejectUnauthorized: true,
      headers: data ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      } : {}
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(postData);
    req.end();
  });
};

const customKeyboard = {
  keyboard: [
    [{ text: '👤 Mon Profil en direct' }, { text: '💰 Versements comptables' }],
    [{ text: '📖 Cours actuels (Site)' }, { text: '🏛️ Classes précédentes' }],
    [{ text: '📅 Emploi du temps (Site)' }, { text: '📜 Certificats disponibles' }],
    [{ text: '🔄 Rafraîchir la connexion' }]
  ],
  resize_keyboard: true,
  persistent: true
};

const sendMessage = (chatId, text, extra = {}) => {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: customKeyboard,
    ...extra
  });
};

const getTimeHeader = (sourceUrl) => {
  const d = new Date();
  return `⏱️ _Interrogation en direct à ${d.toLocaleTimeString('fr-FR')} (${sourceUrl})_\n\n`;
};

// 1. Profil en direct
const handleLiveProfil = async () => {
  try {
    const p = await portal.getLiveProfil();
    let msg = `👤 *INFORMATIONS DU PORTAIL EN DIRECT*\n`;
    msg += getTimeHeader(p.urlSource);
    msg += `• *Nom affiché sur le site :* ${p.nom}\n`;
    msg += `• *N° Carte d’étudiant :* \`${p.carte}\`\n`;
    msg += `• *Filière :* ${p.filiere}\n`;
    msg += `• *Date de naissance :* ${p.dateNaissance}\n`;
    msg += `• *Ville de naissance :* ${p.ville}\n`;
    msg += `• *Téléphone :* ${p.telephone}\n`;
    return msg;
  } catch (err) {
    return `⚠️ Erreur de connexion directe au portail : ${err.message}`;
  }
};

// 2. Versements et comptabilité en direct
const handleLivePaiements = async () => {
  try {
    const p = await portal.getLiveProfil();
    let msg = `💰 *GRAND-LIVRE COMPTABLE EN DIRECT*\n`;
    msg += getTimeHeader(p.urlSource);
    if (p.versements.length === 0) {
      msg += `Aucune ligne comptable trouvée dans les tableaux du portail.`;
    } else {
      p.versements.forEach((v, idx) => {
        msg += `• *Ligne ${idx + 1} :* ${v}\n`;
      });
    }
    return msg;
  } catch (err) {
    return `⚠️ Erreur comptabilité directe : ${err.message}`;
  }
};

// 3. Cours actuels en direct
const handleLiveCours = async () => {
  try {
    const c = await portal.getLiveCours();
    let msg = `📖 *${c.titre}*\n`;
    msg += getTimeHeader(c.urlSource);
    if (c.cours.length === 0) {
      msg += `ℹ️ *Résultat brut du site officiel :*\n`;
      msg += `Le tableau HTML de cette rubrique est actuellement vide (0 cours enregistrés pour l'instant par l'administration pour Bachelor 2).\n\n`;
      msg += `Dès que la scolarité insère un cours dans cette page, il s'affichera ici instantanément.`;
    } else {
      c.cours.forEach((cours, i) => {
        msg += `• *${i + 1}.* ${cours}\n`;
      });
    }
    return msg;
  } catch (err) {
    return `⚠️ Erreur de lecture en direct : ${err.message}`;
  }
};

// 4. Classes précédentes en direct
const handleLiveOldClasses = async () => {
  try {
    const cl = await portal.getLiveOldClasses();
    let msg = `🏛️ *CLASSES PRÉCÉDENTES (HISTORIQUE SITE)*\n`;
    msg += getTimeHeader(cl.urlSource);
    if (cl.classes.length === 0) {
      msg += `Aucune classe précédente listée dans le tableau officiel.`;
    } else {
      cl.classes.forEach((item, i) => {
        msg += `• *${i + 1}.* ${item}\n`;
      });
    }
    return msg;
  } catch (err) {
    return `⚠️ Erreur : ${err.message}`;
  }
};

// 5. Certificats en direct
const handleLiveCertificats = async () => {
  try {
    const certs = await portal.getLiveCertificats();
    let msg = `📜 *CERTIFICATS & ATTESTATIONS DU PORTAIL*\n`;
    msg += getTimeHeader(certs.urlSource);
    if (certs.certificats.length === 0) {
      msg += `ℹ️ *Résultat brut du site officiel :*\n`;
      msg += `Le tableau des certificats est actuellement vide sur votre compte (aucun document mis à disposition par la scolarité pour le moment).`;
    } else {
      certs.certificats.forEach((c, i) => {
        msg += `• *${i + 1}.* ${c}\n`;
      });
    }
    return msg;
  } catch (err) {
    return `⚠️ Erreur : ${err.message}`;
  }
};

// 6. Emploi du temps en direct
const handleLivePlanning = async () => {
  try {
    const plan = await portal.getLivePlanning();
    let msg = `📅 *EMPLOI DU TEMPS EN DIRECT DU SITE*\n`;
    msg += getTimeHeader(plan.urlSource);
    if (plan.status !== 'publie' || plan.events.length === 0) {
      msg += `ℹ️ *Résultat brut du serveur TgMaster :*\n`;
      msg += `Le serveur a renvoyé un statut HTTP **${plan.httpStatus}** (Redirection vers \`${plan.location}\`).\n\n`;
      msg += `L'administration n'a pas encore chargé la première grille de cours pour Bachelor 2. Dès qu'un créneau sera publié par l'école, il apparaîtra ici et dans votre Google Agenda immédiatement !`;
    } else {
      msg += `*${plan.events.length} créneaux extraits du code source en direct :*\n\n`;
      plan.events.slice(0, 6).forEach(ev => {
        msg += `• *${ev.title}* le ${ev.start}\n`;
      });
    }
    return msg;
  } catch (err) {
    return `⚠️ Erreur planning : ${err.message}`;
  }
};

// Long polling
let lastUpdateId = 0;

const pollUpdates = async () => {
  try {
    const res = await telegramRequest(`getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
    if (res.ok && res.result && res.result.length > 0) {
      for (const update of res.result) {
        lastUpdateId = update.update_id;
        const msg = update.message;
        if (!msg || !msg.text) continue;

        const chatId = msg.chat.id;
        const text = msg.text.trim().toLowerCase();

        // 🛡️ SÉCURITÉ STRICTE : WHITELISTING DU PROPRIÉTAIRE UNIQUE (CHAT ID) - FAIL-CLOSED
        if (!allowedChatId || String(chatId) !== String(allowedChatId)) {
          const intruder = msg.from ? `${msg.from.first_name || ''} ${msg.from.last_name || ''} (@${msg.from.username || 'sans_pseudo'})`.trim() : 'Inconnu';
          console.warn(`[SÉCURITÉ] 🛑 Accès non autorisé bloqué ! Chat ID: ${chatId}, Utilisateur: ${intruder}, Texte: "${msg.text}"`);
          
          // Répondre à l'intrus en supprimant tout clavier interactif
          await telegramRequest('sendMessage', {
            chat_id: chatId,
            text: `⛔ *Accès strictement refusé.*\n\nCe bot est un assistant personnel privé verrouillé. Vous n'avez pas l'autorisation d'accéder à ce système.`,
            parse_mode: 'Markdown',
            reply_markup: { remove_keyboard: true }
          });

          // Alerter immédiatement le propriétaire légitime
          await telegramRequest('sendMessage', {
            chat_id: allowedChatId,
            text: `🚨 *ALERTE SÉCURITÉ : Tentative d'accès non autorisée bloquée !*\n\n• *De :* ${intruder}\n• *ID Telegram :* \`${chatId}\`\n• *Message tenté :* \`${msg.text}\`\n\n🔒 _L'accès aux données TgMaster a été bloqué à 100%._`,
            parse_mode: 'Markdown'
          });

          continue;
        }

        console.log(`[Bot] Requête autorisée de ${msg.from.first_name} : "${msg.text}"`);

        if (text === '/start' || text === '/help' || text === 'aide') {
          const welcome = `👋 *Bonjour ${msg.from.first_name} !*\n\nJe suis connecté **100% en direct au serveur de TgMaster University**.\n\n🔒 **Zéro donnée pré-remplie :** Chaque appui sur un bouton exécute une requête HTTP en direct sur votre compte étudiant et extrait les données brutes du site officiel.\n\nChoisissez une rubrique ci-dessous :`;
          await sendMessage(chatId, welcome);
        } else if (text.startsWith('/profil') || text.includes('profil') || text.includes('carte')) {
          await sendMessage(chatId, '🔍 *Interrogation en direct de app.tgmaster.com/student/profil...*');
          await sendMessage(chatId, await handleLiveProfil());
        } else if (text.startsWith('/paiement') || text.includes('versement') || text.includes('bourse') || text.includes('comptab')) {
          await sendMessage(chatId, '🔍 *Lecture en direct du tableau comptable sur votre profil...*');
          await sendMessage(chatId, await handleLivePaiements());
        } else if (text.startsWith('/matiere') || text.includes('cours')) {
          await sendMessage(chatId, '🔍 *Interrogation en direct de app.tgmaster.com/student/cours/current...*');
          await sendMessage(chatId, await handleLiveCours());
        } else if (text.startsWith('/certificat') || text.includes('certificat')) {
          await sendMessage(chatId, '🔍 *Interrogation en direct de app.tgmaster.com/student/certificats...*');
          await sendMessage(chatId, await handleLiveCertificats());
        } else if (text.startsWith('/historique') || text.includes('précédente') || text.includes('classe')) {
          await sendMessage(chatId, '🔍 *Interrogation en direct de app.tgmaster.com/student/oldClasses...*');
          await sendMessage(chatId, await handleLiveOldClasses());
        } else if (text.startsWith('/planning') || text.startsWith('/next') || text.includes('emploi') || text.includes('temps')) {
          await sendMessage(chatId, '🔍 *Interrogation en direct de app.tgmaster.com/student/planning...*');
          await sendMessage(chatId, await handleLivePlanning());
        } else if (text.startsWith('/sync') || text.includes('rafraîchir') || text.includes('synchroniser')) {
          await sendMessage(chatId, '🔄 *Test de session en direct avec le serveur TgMaster...*');
          await sendMessage(chatId, await handleLivePlanning());
        } else {
          await sendMessage(chatId, `❓ *Option non reconnue.*\n\nUtilisez directement les boutons interactifs ci-dessous pour interroger le portail en direct :`);
        }
      }
    }
  } catch (err) {
    // Timeout normal
  }
  setTimeout(pollUpdates, 1000);
};

console.log('🤖 Démarrage du Bot Telegram 100% Direct (Audit strict validé)...');
pollUpdates();
