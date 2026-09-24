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
const allowedUserId = process.env.TELEGRAM_ALLOWED_USER_ID || config.TELEGRAM_ALLOWED_USER_ID || allowedChatId;

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

    const MAX_TELEGRAM_RESPONSE = 5 * 1024 * 1024; // 5 Mo maximum
    const req = https.request(options, res => {
      let body = '';
      let totalBytes = 0;
      res.on('data', c => {
        totalBytes += c.length;
        if (totalBytes > MAX_TELEGRAM_RESPONSE) {
          req.destroy(new Error('Réponse Telegram dépassant la limite autorisée (5 Mo)'));
          return;
        }
        body += c;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    });
    req.setTimeout(15000, () => {
      req.destroy(new Error('Délai d\'attente Telegram dépassé (15s)'));
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

// Cache mémoire borné avec TTL pour prévenir tout déni de service et fuite mémoire
class BoundedTtlCache {
  constructor(maxSize = 100, ttlMs = 600000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.time > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    return entry.val;
  }
  set(key, val) {
    // R6: Éviction uniquement si la clé est nouvelle et que le cache est plein
    if (!this.map.has(key) && this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
    this.map.set(key, { val, time: Date.now() });
  }
}

const intruderCooldowns = new BoundedTtlCache(100, 60000); // 60s cooldown de réponse par intrus
const intruderAlertCooldowns = new BoundedTtlCache(50, 120000); // 2min cooldown alertes propriétaire

// R5: Quota global sortant pour les réponses intrus (max 20 messages de refus par minute)
let globalOutboundCount = 0;
let globalOutboundReset = Date.now();
const canSendOutboundRefusal = () => {
  const now = Date.now();
  if (now - globalOutboundReset > 60000) {
    globalOutboundCount = 0;
    globalOutboundReset = now;
  }
  if (globalOutboundCount >= 20) return false;
  globalOutboundCount++;
  return true;
};

// Plafond global d'alertes vers le propriétaire (Anti-Flood Sybil : max 5 alertes/minute tous intrus confondus)
let globalAlertCount = 0;
let globalAlertReset = Date.now();
let alertSpikeNotified = false;

const canSendOwnerAlert = () => {
  const now = Date.now();
  if (now - globalAlertReset > 60000) {
    globalAlertCount = 0;
    globalAlertReset = now;
    alertSpikeNotified = false;
  }
  if (globalAlertCount >= 5) {
    if (!alertSpikeNotified) {
      alertSpikeNotified = true;
      return 'SPIKE_WARNING';
    }
    return false; // Abandon silencieux au-delà de 5 alertes/minute
  }
  globalAlertCount++;
  return true;
};

// Long polling
let lastUpdateId = 0;

const pollUpdates = async () => {
  try {
    // R2: Filtrage strict au niveau API Telegram (messages texte uniquement)
    const res = await telegramRequest(`getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=%5B%22message%22%5D`);
    if (res.ok && res.result && Array.isArray(res.result)) {
      for (const update of res.result) {
        lastUpdateId = update.update_id;
        const msg = update.message;

        // R2: Gardes structurelles complètes (élimine tout risque de TypeError sur msg ou msg.chat)
        if (!msg || typeof msg !== 'object' || !msg.chat || typeof msg.chat.id === 'undefined' || typeof msg.text !== 'string') {
          continue;
        }

        // R4: Anti-replay des messages périmés accumulés pendant une coupure (seuil: 120s)
        if (msg.date && ((Date.now() / 1000) - msg.date > 120)) {
          continue;
        }

        const chatId = msg.chat.id;
        const chatType = msg.chat.type;
        const fromId = msg.from?.id || null;
        const text = msg.text.trim().toLowerCase();

        // 🛡️ SÉCURITÉ ABSOLUE : TYPE PRIVÉ EXCLUSIF + DOUBLE WHITELIST SÉPARÉE (CHAT + USER) - FAIL-CLOSED
        const isAuthorized = chatType === 'private' &&
                             allowedChatId &&
                             String(chatId) === String(allowedChatId) &&
                             allowedUserId &&
                             String(fromId) === String(allowedUserId);

        if (!isAuthorized) {
          // R3: Normalisation stricte contre les injections visuelles (newlines, caractères Bidi, contrôle)
          const sanitizeVisual = (str, maxLen = 60) => {
            return String(str || '')
              .replace(/[\r\n\t]/g, ' ')
              .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
              .substring(0, maxLen)
              .trim();
          };

          const safeFirstName = sanitizeVisual(msg.from?.first_name || 'Inconnu', 40);
          const safeUsername = sanitizeVisual(msg.from?.username || 'sans_pseudo', 40);
          const safeIntruder = `"${safeFirstName}" (@${safeUsername})`;
          const safeText = `"${sanitizeVisual(msg.text, 80)}"`;

          console.warn(`[SÉCURITÉ] 🛑 Accès non autorisé bloqué ! Chat ID: ${chatId}, Type: ${chatType}, User: ${safeIntruder}`);

          // Anti-DoS : Si cet intrus a déjà été notifié dans les 60s, DROP SILENCIEUX (zéro requête réseau)
          if (intruderCooldowns.get(chatId)) {
            continue;
          }
          intruderCooldowns.set(chatId, Date.now());

          // R5: Vérification du quota global sortant avant envoi du refus
          if (canSendOutboundRefusal()) {
            try {
              await telegramRequest('sendMessage', {
                chat_id: chatId,
                text: `⛔ Accès strictement refusé. Cet assistant personnel est verrouillé.`,
                reply_markup: { remove_keyboard: true }
              });
            } catch (err) {
              console.warn('[Bot] Échec envoi message refus intrus :', err.message); // R9
            }
          }

          // Alerte propriétaire en TEXTE BRUT pur avec double protection (per-clé + plafond global anti-Sybil 5/min)
          if (!intruderAlertCooldowns.get(chatId)) {
            intruderAlertCooldowns.set(chatId, Date.now());
            const alertStatus = canSendOwnerAlert();
            if (alertStatus === true) {
              try {
                await telegramRequest('sendMessage', {
                  chat_id: allowedChatId,
                  text: `[ALERTE SECURITE] Tentative bloquée !\n• Type chat : "${chatType}"\n• Utilisateur : ${safeIntruder}\n• ID Telegram : ${chatId}\n• Message : ${safeText}\n\nL'accès aux données TgMaster a été bloqué à 100%.`
                });
              } catch (err) {
                console.warn('[Bot] Échec envoi alerte propriétaire :', err.message); // R9
              }
            } else if (alertStatus === 'SPIKE_WARNING') {
              try {
                await telegramRequest('sendMessage', {
                  chat_id: allowedChatId,
                  text: `[ALERTE SECURITE CRITIQUE] Pic d'attaques distribuées détecté (> 5 tentatives d'accès distinctes en 1 min). Les alertes individuelles suivantes sont temporairement réduites au silence pour protéger vos notifications.`
                });
              } catch (err) {
                console.warn('[Bot] Échec envoi notification pic d\'attaque :', err.message);
              }
            }
          }

          continue;
        }

        // Rate-limiting utilisateur légitime (1 commande toutes les 1.5s max pour préserver le portail)
        const nowReq = Date.now();
        if (global.lastUserCommand && (nowReq - global.lastUserCommand < 1500)) {
          await sendMessage(chatId, '⏱️ _Veuillez patienter un instant entre deux clics..._');
          continue;
        }
        global.lastUserCommand = nowReq;

        console.log(`[Bot] Requête autorisée de ${msg.from?.first_name || 'Propriétaire'} : "${msg.text}"`);

        if (text === '/start' || text === '/help' || text === 'aide') {
          const welcome = `👋 *Bonjour ${msg.from?.first_name || 'Étudiant'} !*\n\nJe suis connecté **100% en direct au serveur de TgMaster University**.\n\n🔒 **Zéro donnée pré-remplie :** Chaque appui sur un bouton exécute une requête HTTP en direct sur votre compte étudiant et extrait les données brutes du site officiel.\n\nChoisissez une rubrique ci-dessous :`;
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

// Démarrage sécurisé : suppression explicite de tout webhook avec vérification stricte (Fail-Closed)
(async () => {
  try {
    const dw = await telegramRequest('deleteWebhook', { drop_pending_updates: true });
    if (!dw || !dw.ok) {
      console.error('Erreur Critique Sécurité: Échec de purge du webhook. Description:', dw ? dw.description : 'Réponse invalide');
      process.exit(1);
    }
    console.log('🔒 Webhook purgé avec succès : Mode Long Polling exclusif actif (zéro endpoint HTTP exposé).');
  } catch (e) {
    console.error('Erreur Critique Sécurité: Impossible de contacter Telegram pour deleteWebhook. Arrêt immédiat.');
    process.exit(1);
  }
  console.log('🤖 Démarrage du Bot Telegram 100% Direct (Audit strict validé)...');
  pollUpdates();
})();
