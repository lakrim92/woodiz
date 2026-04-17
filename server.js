require('dotenv').config();

// ── Validation des variables d'env obligatoires au démarrage ──
['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SITE_URL', 'TABLETTE_PASSWORD', 'ADMIN_PASSWORD'].forEach(k => {
  if (!process.env[k]) {
    console.error(`❌ Variable d'env requise manquante : ${k}`);
    process.exit(1);
  }
});

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const http     = require('http');
const https    = require('https');
const net      = require('net');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3005;

// ── Headers sécurité ──────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com; " +
    "style-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com 'unsafe-inline'; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "connect-src 'self' https://api.stripe.com; " +
    "frame-src https://checkout.stripe.com https://maps.google.com https://www.google.com; " +
    "img-src 'self' data: https:;"
  );
  next();
});
const ORDERS_FILE       = path.join(__dirname, 'orders.json');
const PENDING_ITEMS_FILE = path.join(__dirname, 'pending_items.json');
const PROMO_USED_FILE   = path.join(__dirname, 'promo_used.json');

// ── Utilitaires sécurité ──────────────────────────────────

// Mutex pour rendre les read-modify-write de fichiers atomiques
class Mutex {
  constructor() { this._p = Promise.resolve(); }
  run(fn) {
    const next = this._p.then(() => fn());
    this._p = next.then(() => {}, () => {});
    return next;
  }
}
const fileMutex = new Mutex();

// Comparaison de chaînes résistante aux timing attacks
function timingSafeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Rate limiter en mémoire (max req par fenêtre de temps)
const _rlStore = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key  = req.ip || 'unknown';
    const now  = Date.now();
    let   slot = _rlStore.get(key);
    if (!slot || now > slot.resetAt) {
      slot = { count: 0, resetAt: now + windowMs };
      _rlStore.set(key, slot);
    }
    if (++slot.count > max) {
      return res.status(429).json({ error: 'Trop de tentatives, réessayez plus tard.' });
    }
    next();
  };
}
// Purge périodique du rate limiter pour éviter la fuite mémoire sur les IPs expirées
setInterval(() => {
  const now = Date.now();
  _rlStore.forEach((v, k) => { if (now > v.resetAt) _rlStore.delete(k); });
}, 60_000);

const rlAuth     = rateLimit(10, 60_000);  // 10 tentatives/min sur les routes auth
const rlCheckout = rateLimit(30, 60_000);  // 30 req/min sur checkout + promo
const rlReceipt  = rateLimit(20, 60_000);  // 20 req/min sur les reçus

// ── Sessions serveur (token aléatoire — jamais stocker le mot de passe côté client) ──
const _sessions = new Map(); // token → { role, expiresAt }
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8h

function createSession(role) {
  const token = crypto.randomBytes(32).toString('hex');
  _sessions.set(token, { role, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

// Purge périodique des sessions expirées
setInterval(() => {
  const now = Date.now();
  _sessions.forEach((v, k) => { if (now > v.expiresAt) _sessions.delete(k); });
}, 60 * 60 * 1000);

// ── Cache mémoire — évite les fs.readFileSync bloquants dans les routes ──
let _ordersCache       = [];
let _promoUsedCache    = [];
let _pendingItemsCache = {};

// ── Persistance promo première commande ───────────────────
function loadPromoUsed()  { return _promoUsedCache; }
function markPromoUsed(email) {
  const normalized = email.trim().toLowerCase();
  if (!_promoUsedCache.includes(normalized)) {
    _promoUsedCache.push(normalized);
    fs.writeFile(PROMO_USED_FILE, JSON.stringify(_promoUsedCache), err => {
      if (err) console.error('promo_used write error:', err.message);
    });
  }
}
function isPromoEligible(email) {
  const normalized = email.trim().toLowerCase();
  if (_promoUsedCache.includes(normalized)) return false;
  return !_ordersCache.some(o => (o.customerEmail || '').toLowerCase() === normalized);
}

// ── Cache coupon promo (1 seul coupon réutilisable par server lifetime) ──
let _promoCouponId = process.env.PROMO_COUPON_ID || null;
async function getPromoCouponId() {
  if (_promoCouponId) return _promoCouponId;
  const coupon = await stripe.coupons.create({
    percent_off: 10,
    duration:    'once',
    name:        'Première commande -10%',
  });
  _promoCouponId = coupon.id;
  console.log(`✅ Coupon promo créé : ${coupon.id} — ajoutez PROMO_COUPON_ID=${coupon.id} dans .env`);
  return _promoCouponId;
}

// ── Persistance commandes ──────────────────────────────────
function loadOrders()       { return _ordersCache; }
function saveOrders(orders) {
  _ordersCache = orders;
  fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), err => {
    if (err) console.error('orders write error:', err.message);
  });
}

// ── Persistance items (résiste aux redémarrages serveur) ──
function loadPendingItems() { return _pendingItemsCache; }
function savePendingItem(sessionId, items) {
  _pendingItemsCache[sessionId] = items;
  fs.writeFile(PENDING_ITEMS_FILE, JSON.stringify(_pendingItemsCache), err => {
    if (err) console.error('pending_items write error:', err.message);
  });
}
function popPendingItem(sessionId) {
  const items = _pendingItemsCache[sessionId];
  if (items) {
    delete _pendingItemsCache[sessionId];
    fs.writeFile(PENDING_ITEMS_FILE, JSON.stringify(_pendingItemsCache), err => {
      if (err) console.error('pending_items write error:', err.message);
    });
  }
  return items || null;
}

// ── Impression thermique (Epson TM-m30, ESC/POS over TCP) ─
const ESC = 0x1B, GS = 0x1D;
const PR = {
  INIT:     Buffer.from([ESC, 0x40]),
  CODEPAGE: Buffer.from([ESC, 0x74, 0x02]),   // PC850 — Latin (accents FR)
  BOLD_ON:  Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([ESC, 0x45, 0x00]),
  ALIGN_C:  Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_L:  Buffer.from([ESC, 0x61, 0x00]),
  SIZE_2X:  Buffer.from([GS,  0x21, 0x11]),
  SIZE_1X:  Buffer.from([GS,  0x21, 0x00]),
  FEED:     Buffer.from([ESC, 0x64, 0x04]),
  CUT:      Buffer.from([GS,  0x56, 0x42, 0x00]),
};

// Strip unsupported chars, convert common French accents to PC850 bytes
function prTxt(s) {
  const map = { 'é':0x82,'è':0x8A,'ê':0x88,'ë':0x89,'à':0x85,'â':0x83,'ù':0xA4,'û':0x96,'ô':0x93,'î':0x8C,'ï':0x8B,'ç':0x87,'É':0x90,'È':0xD4,'À':0xB7,'Ç':0x80 };
  const out = [];
  for (const ch of String(s || '')) {
    if (map[ch] !== undefined) out.push(map[ch]);
    else if (ch.charCodeAt(0) < 0x80) out.push(ch.charCodeAt(0));
  }
  return Buffer.from(out);
}
function prLine(s) { return Buffer.concat([prTxt(s), Buffer.from([0x0A])]); }

function printOrder(order) {
  const host = process.env.PRINTER_HOST;
  const port = parseInt(process.env.PRINTER_PORT || '9100');
  if (!host) return;

  const d          = order.delivery || {};
  const now        = new Date(order.createdAt);
  const dateStr    = now.toLocaleDateString('fr-FR');
  const timeStr    = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const orderNum   = String(order.orderNumber).slice(-6);
  const isLivraison = d.mode === 'livraison';
  const name       = `${d.firstname || d.prenom || ''} ${d.lastname || d.nom || ''}`.trim();
  const sep        = '--------------------------------';

  const chunks = [
    PR.INIT, PR.CODEPAGE,
    PR.ALIGN_C, PR.BOLD_ON, PR.SIZE_2X,
    prLine('PANUOZZO'),
    PR.SIZE_1X, PR.BOLD_OFF,
    prLine(`${dateStr}  ${timeStr}`),
    prLine(`Commande #${orderNum}`),
    PR.ALIGN_L,
    prLine(sep),
    PR.BOLD_ON,
    prLine(isLivraison ? '>>> LIVRAISON <<<' : '>>> A EMPORTER <<<'),
    PR.BOLD_OFF,
  ];

  if (name)                     chunks.push(prLine(`Client : ${name}`));
  const phone = d.phone || d.telephone;
  if (phone)                    chunks.push(prLine(`Tel    : ${phone}`));
  if (isLivraison) {
    const addr = [d.address || d.adresse, d.zip, d.city].filter(Boolean).join(' ');
    if (addr)                   chunks.push(prLine(`Adresse: ${addr}`));
    if (d.floor || d.etage)     chunks.push(prLine(`Etage  : ${d.floor || d.etage}`));
    if (d.appt)                 chunks.push(prLine(`Apt    : ${d.appt}`));
    if (d.code || d.codeAcces)  chunks.push(prLine(`Code   : ${d.code || d.codeAcces}`));
  }
  chunks.push(prLine(sep));

  (order.items || []).forEach(item => {
    const price = `${(item.price || 0).toFixed(2)}EUR`;
    const label = `${item.qty || 1}x ${item.name}`;
    const pad   = Math.max(1, 32 - label.length - price.length);
    chunks.push(PR.BOLD_ON, prTxt(label + ' '.repeat(pad) + price), Buffer.from([0x0A]), PR.BOLD_OFF);
    if (item.removed?.length) chunks.push(prLine(`  - Sans : ${item.removed.join(', ')}`));
    if (item.added?.length)   chunks.push(prLine(`  + ${item.added.map(a => `${a.qty > 1 ? a.qty + 'x ' : ''}${a.name}`).join(', ')}`));
    if (item.meatChoice)      chunks.push(prLine(`  Viande : ${item.meatChoice}`));
  });

  chunks.push(prLine(sep));
  chunks.push(PR.BOLD_ON, prLine(`TOTAL  : ${(order.total || 0).toFixed(2)} EUR`), PR.BOLD_OFF);
  if (order.promoApplied) chunks.push(prLine(`Promo -10% appliquee !`));

  const instructions = d.instructions || d.notes;
  if (instructions) { chunks.push(prLine('')); chunks.push(prLine(`Note: ${instructions}`)); }

  chunks.push(PR.FEED, PR.CUT);

  const data   = Buffer.concat(chunks);
  const socket = new net.Socket();
  socket.setTimeout(5000);
  socket.connect(port, host, () => {
    socket.write(data, () => socket.destroy());
    console.log(`🖨️  Ticket imprimé → ${host}:${port} (commande #${orderNum})`);
  });
  socket.on('error', err => console.error(`Printer error: ${err.message}`));
  socket.on('timeout', () => { console.error('Printer timeout'); socket.destroy(); });
}

// ── SSE — tablette temps réel ──────────────────────────────
const sseClients = new Set();
function pushSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => res.write(payload));
}

// ── Email (Nodemailer) ─────────────────────────────────────
const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});
async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return;
  try {
    await mailer.sendMail({ from: `"PANUOZZO 🍕" <${process.env.SMTP_USER}>`, to, subject, html });
    console.log(`📧 Email envoyé → ${to}`);
  } catch (err) {
    console.error('Email error:', err.message);
  }
}

// ── SMS (Twilio REST — sans SDK) ───────────────────────────
function sendSMS(to, body) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !to) return Promise.resolve();
  // Normalise le numéro FR : 06… → +336…
  const normalized = to.trim().startsWith('+') ? to.trim()
    : `+33${to.trim().replace(/^0/, '')}`;
  const postData = new URLSearchParams({
    To:   normalized,
    From: process.env.TWILIO_PHONE,
    Body: body,
  }).toString();
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
      method: 'POST',
      auth: `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`,
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, res => { res.resume(); res.on('end', () => { console.log(`📱 SMS envoyé → ${normalized}`); resolve(); }); });
    req.on('error', err => { console.error('SMS error:', err.message); resolve(); });
    req.write(postData);
    req.end();
  });
}

// Escape HTML — empêche l'injection HTML dans les emails admin via données client
function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Traitement commande (webhook + confirm) ────────────────
async function processOrder(session) {
  // Récupérer les items complets (avec added/removed/desc) — résistant aux redémarrages
  const savedItems = popPendingItem(session.id);
  let items;
  if (savedItems) {
    items = savedItems;
  } else {
    // Fallback : reconstruire depuis Stripe (sans les détails ingrédients)
    const li = await stripe.checkout.sessions.listLineItems(session.id, { limit: 50 });
    items = li.data.map(i => ({
      name:  i.description,
      qty:   i.quantity,
      price: i.amount_total / 100,
    }));
  }

  // Infos livraison depuis metadata
  let delivery = {};
  try { delivery = JSON.parse(session.metadata?.delivery || '{}'); } catch {}

  // Marquer l'email promo comme utilisé (si applicable)
  if (session.metadata?.promoEmail) {
    markPromoUsed(session.metadata.promoEmail);
  }

  const promoApplied = !!session.metadata?.promoEmail;
  const subtotal     = (session.amount_subtotal || session.amount_total) / 100;
  const discount     = promoApplied
    ? Math.round((subtotal - session.amount_total / 100) * 100) / 100
    : 0;

  const order = {
    id:            session.id,
    orderNumber:   Date.now(),
    createdAt:     new Date().toISOString(),
    status:        'nouveau',
    customerEmail: session.customer_details?.email || '',
    items,
    delivery,
    total:         session.amount_total / 100,
    promoApplied,
    discount,
  };

  // ── Section critique : anti-doublon atomique + sauvegarde ──
  let skipped = false;
  await fileMutex.run(() => {
    const orders = loadOrders();
    if (orders.find(o => o.id === session.id)) { skipped = true; return; }
    orders.unshift(order);
    saveOrders(orders);
  });

  if (skipped) {
    console.log(`⚠️  Commande ${session.id} déjà traitée — ignorée`);
    return;
  }

  pushSSE('new-order', order);

  // Texte de la commande
  const itemsList = items.map(i => `• ${i.qty || 1}x ${i.name}`).join('\n');
  const itemsHtml = items.map(i => {
    const price = typeof i.price === 'number' ? i.price.toFixed(2) : '—';
    const details = [];
    if (i.desc)            details.push(`<span style="color:#555">${escHtml(i.desc)}</span>`);
    if (i.removed?.length) details.push(`<span style="color:#dc2626">Sans : ${i.removed.map(escHtml).join(', ')}</span>`);
    if (i.added?.length)   details.push(`<span style="color:#16a34a">+ ${i.added.map(a => `${a.qty > 1 ? a.qty + '× ' : ''}${escHtml(a.name)}`).join(', ')}</span>`);
    if (i.meatChoice)      details.push(`<span style="color:#b45309">Viande : ${escHtml(i.meatChoice)}</span>`);
    const detailHtml = details.length ? `<br><span style="font-size:.82em;line-height:1.6">${details.join('<br>')}</span>` : '';
    return `<tr><td style="padding:6px 0">${i.qty || 1}× <strong>${escHtml(i.name)}</strong>${detailHtml}</td><td align="right" style="vertical-align:top;padding-top:6px">${price}€</td></tr>`;
  }).join('');
  const modeLabel = delivery.mode === 'livraison' ? 'Livraison' : 'Retrait sur place';
  const addrLine  = [
    [delivery.address || delivery.adresse, delivery.zip, delivery.city].filter(Boolean).join(' '),
    (delivery.floor || delivery.etage) && `Étage ${delivery.floor || delivery.etage}`,
    delivery.appt && `Apt ${delivery.appt}`,
    (delivery.building || delivery.batiment) && `Bât. ${delivery.building || delivery.batiment}`,
    (delivery.code || delivery.codeAcces) && `Code ${delivery.code || delivery.codeAcces}`,
  ].filter(Boolean).join(', ');
  const addrLineEsc = escHtml(addrLine);

  // ── Email confirmation client ──
  // (sendSMS désactivé — Twilio non configuré)

  // ── Email client ──
  console.log(`📧 Email client : ${order.customerEmail || '(aucun email)'}`);
  if (order.customerEmail) {
    await sendEmail(order.customerEmail, '🍕 Votre commande PANUOZZO est confirmée !', `
      ${emailBrandBlock()}
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
        <div style="background:#1a6b4e;padding:18px 32px">
          <h1 style="color:#fff;margin:0;font-size:1.3rem">🍕 Commande confirmée !</h1>
        </div>
        <div style="padding:28px 32px">
          <p style="margin-top:0">Bonjour <strong>${escHtml(delivery.firstname || delivery.prenom || '')}</strong>,</p>
          <p>Votre commande est bien enregistrée et en cours de préparation.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:.92rem">
            ${itemsHtml}
            <tr><td colspan="2" style="padding:4px 0"><hr style="border:none;border-top:1px solid #eee"/></td></tr>
            ${order.promoApplied ? `<tr><td style="color:#16a34a;font-size:.88rem">🎉 Réduction première commande (-10%)</td><td align="right" style="color:#16a34a;font-size:.88rem">-${order.discount.toFixed(2)}€</td></tr>` : ''}
            <tr><td><strong>Total payé</strong></td><td align="right"><strong>${order.total.toFixed(2)}€</strong></td></tr>
          </table>
          ${order.promoApplied ? `<p style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;font-size:.88rem;color:#15803d;margin-bottom:12px">🎉 Vous avez bénéficié de la réduction <strong>première commande -10%</strong> ! Économie de <strong>${order.discount.toFixed(2)}€</strong>.</p>` : ''}
          <p><strong>Mode :</strong> ${modeLabel}${delivery.mode === 'livraison' && addrLineEsc ? ` — ${addrLineEsc}` : ''}</p>
          <p style="color:#666;font-size:.88rem">⏱ Temps estimé : ~30 minutes</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
          <p style="margin-bottom:16px">
            <a href="${process.env.SITE_URL}/api/receipt/${session.id}" style="display:inline-block;background:#1a6b4e;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:.9rem;font-weight:600">📄 Télécharger mon reçu</a>
          </p>
          <p style="color:#999;font-size:.8rem;margin:0">PANUOZZO — 30 Av. Jean Moulin, 78380 Bougival · 01 75 26 91 20</p>
        </div>
      </div>
    `);
  }

  // ── Email admin ──
  console.log(`📧 Email admin : ${process.env.ADMIN_EMAIL || '(ADMIN_EMAIL non défini)'}`);
  if (process.env.ADMIN_EMAIL) {
    await sendEmail(process.env.ADMIN_EMAIL,
      `🔔 Nouvelle commande${order.promoApplied ? ' 🎉 -10%' : ''} — ${escHtml(delivery.firstname || delivery.prenom || '')} ${escHtml(delivery.lastname || delivery.nom || '')} — ${order.total.toFixed(2)}€`,
      `
      ${emailBrandBlock()}
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
        <div style="background:#dc2626;padding:16px 28px">
          <h1 style="color:#fff;margin:0;font-size:1.2rem">🔔 Nouvelle commande</h1>
        </div>
        <div style="padding:24px 28px">
          <table style="width:100%;font-size:.9rem;margin-bottom:16px">
            <tr><td style="padding:4px 0;color:#666;width:130px">Client</td><td><strong>${escHtml(delivery.firstname || delivery.prenom || '')} ${escHtml(delivery.lastname || delivery.nom || '')}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666">Téléphone</td><td>${escHtml(delivery.phone || delivery.telephone || '—')}</td></tr>
            <tr><td style="padding:4px 0;color:#666">Mode</td><td><strong>${escHtml(modeLabel)}</strong></td></tr>
            ${delivery.mode === 'livraison' && addrLine ? `<tr><td style="padding:4px 0;color:#666">Adresse</td><td>${escHtml(addrLine)}</td></tr>` : ''}
            ${delivery.appt ? `<tr><td style="padding:4px 0;color:#666">Appartement</td><td>${escHtml(delivery.appt)}</td></tr>` : ''}
            ${(delivery.notes || delivery.instructions) ? `<tr><td style="padding:4px 0;color:#666">Instructions</td><td>${escHtml(delivery.notes || delivery.instructions)}</td></tr>` : ''}
          </table>
          <h3 style="margin-bottom:8px">Articles</h3>
          <table style="width:100%;border-collapse:collapse;font-size:.9rem">
            ${itemsHtml}
            <tr><td colspan="2" style="padding:4px 0"><hr style="border:none;border-top:1px solid #eee"/></td></tr>
            ${order.promoApplied ? `<tr><td style="color:#16a34a;font-size:.85rem">🎉 Promo première commande (-10%)</td><td align="right" style="color:#16a34a;font-size:.85rem">-${order.discount.toFixed(2)}€</td></tr>` : ''}
            <tr><td><strong>Total</strong></td><td align="right"><strong>${order.total.toFixed(2)}€</strong></td></tr>
          </table>
          <p style="color:#999;font-size:.78rem;margin-top:16px">Session Stripe : ${session.id}</p>
        </div>
      </div>
    `);
  }

  // ── Impression ticket cuisine ──
  printOrder(order);

  console.log(`✅ Commande #${order.orderNumber} traitée — ${order.total}€`);
}

// ── Webhook Stripe (raw body AVANT express.json) ──────────
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    try { await processOrder(event.data.object); } catch (err) { console.error('Webhook order error:', err.message); }
  }

  res.json({ received: true });
});

app.use(express.json());

// ── Bloc marque réutilisé dans tous les emails ────────────
function emailBrandBlock() {
  const siteUrl = process.env.SITE_URL;
  return `<style>@import url('https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap');</style>
<div style="text-align:center;padding:20px 20px 14px;background:#fff;border-bottom:1px solid #f0ede8">
  <img src="${siteUrl}/images/svg/logo_panuozzo_transparent.png" alt="PANUOZZO" style="height:54px;width:auto;display:block;margin:0 auto 8px">
  <div style="font-family:'Great Vibes',Georgia,serif;font-size:2.4rem;line-height:1.1">
    <span style="color:#dc2626">Pan</span><span style="color:#1c1917">uoz</span><span style="color:#1a6b4e">zo</span>
  </div>
  <p style="margin:4px 0 0;font-size:.7rem;color:#999;text-transform:uppercase;letter-spacing:1.5px;font-family:Arial,sans-serif">Pizza au feu de bois · Bougival</p>
</div>`;
}

// ── Génération reçu fiscal (conforme CGI art. 242 nonies A) ──
function generateReceiptHtml(order) {
  const d          = new Date(order.createdAt);
  const dateStr    = d.toLocaleDateString('fr-FR');
  const timeStr    = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const ymd        = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const seq        = String(order.orderNumber).slice(-6);
  const receiptNum = `PANU-${ymd}-${seq}`;
  const delivery   = order.delivery || {};
  const clientName = [delivery.firstname || delivery.prenom, delivery.lastname || delivery.nom].filter(Boolean).join(' ');
  const isLivraison = delivery.mode === 'livraison';
  const addrLine   = [delivery.address || delivery.adresse, delivery.zip, delivery.city].filter(Boolean).join(' ');
  const modeLabel  = isLivraison ? 'Livraison à domicile' : 'Retrait sur place';

  // TVA : 10% sur plats cuisinés, 5.5% sur boissons
  const tvaGroups  = {}; // rate → { baseHT, montantTVA, totalTTC }
  const items      = order.items || [];
  const subtotalBC = items.reduce((s, i) => s + (i.price || 0), 0);

  const itemsRows = items.map(item => {
    const qty       = item.qty || 1;
    const priceTTC  = typeof item.price === 'number' ? item.price : 0;
    const rate      = item.type === 'boisson' ? 5.5 : 10;
    const prixUnit  = priceTTC / qty;
    const ht        = priceTTC / (1 + rate / 100);
    const tva       = priceTTC - ht;
    if (!tvaGroups[rate]) tvaGroups[rate] = { baseHT: 0, montantTVA: 0, totalTTC: 0 };
    tvaGroups[rate].baseHT     += ht;
    tvaGroups[rate].montantTVA += tva;
    tvaGroups[rate].totalTTC   += priceTTC;
    const detailHtml = item.desc ? `<br><span style="font-size:.8rem;color:#777">${escHtml(item.desc)}</span>` : '';
    return `<tr>
      <td style="padding:8px 10px">${escHtml(item.name)}${detailHtml}</td>
      <td style="padding:8px 10px;text-align:center">${qty}</td>
      <td style="padding:8px 10px;text-align:right">${prixUnit.toFixed(2)} €</td>
      <td style="padding:8px 10px;text-align:center">${rate}%</td>
      <td style="padding:8px 10px;text-align:right">${priceTTC.toFixed(2)} €</td>
    </tr>`;
  }).join('');

  // Si promo : ajuster les bases TVA proportionnellement au total réel
  if (order.promoApplied && order.discount > 0 && subtotalBC > 0) {
    const ratio = order.total / subtotalBC;
    Object.values(tvaGroups).forEach(g => {
      g.baseHT     *= ratio;
      g.montantTVA *= ratio;
      g.totalTTC   *= ratio;
    });
  }

  const totalHT  = Object.values(tvaGroups).reduce((s, g) => s + g.baseHT, 0);
  const totalTVA = Object.values(tvaGroups).reduce((s, g) => s + g.montantTVA, 0);

  const tvaRecapRows = Object.entries(tvaGroups)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([rate, g]) => `<tr>
      <td style="padding:5px 8px;font-size:.83rem">${rate}%</td>
      <td style="padding:5px 8px;text-align:right;font-size:.83rem">${g.baseHT.toFixed(2)} €</td>
      <td style="padding:5px 8px;text-align:right;font-size:.83rem">${g.montantTVA.toFixed(2)} €</td>
      <td style="padding:5px 8px;text-align:right;font-size:.83rem">${g.totalTTC.toFixed(2)} €</td>
    </tr>`).join('');

  const promoRow = order.promoApplied && order.discount > 0
    ? `<tr><td style="color:#16a34a;padding:5px 8px">Réduction 1ère commande (-10%)</td><td style="text-align:right;color:#16a34a;padding:5px 8px">-${order.discount.toFixed(2)} €</td></tr>
       <tr><td style="padding:5px 8px;color:#555">Sous-total avant réduction</td><td style="text-align:right;padding:5px 8px">${subtotalBC.toFixed(2)} €</td></tr>`
    : '';

  const clientBox = (clientName || isLivraison) ? `
    <div class="info-box">
      <p class="section-title">Client</p>
      ${clientName ? `<p><strong>${escHtml(clientName)}</strong></p>` : ''}
      ${order.customerEmail ? `<p>${escHtml(order.customerEmail)}</p>` : ''}
      ${isLivraison && addrLine ? `<p>${escHtml(addrLine)}</p>` : ''}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reçu ${receiptNum} — PANUOZZO</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;max-width:860px;margin:0 auto;padding:24px 16px;background:#f5f5f0;color:#1a1a1a}
  .receipt{background:#fff;border-radius:12px;padding:36px 32px;box-shadow:0 2px 18px rgba(0,0,0,.09)}
  .btn-print{display:inline-flex;align-items:center;gap:8px;background:#1a6b4e;color:#fff;border:none;padding:11px 22px;border-radius:8px;font-size:.93rem;cursor:pointer;margin-bottom:22px;text-decoration:none;font-family:Arial,sans-serif}
  .btn-print:hover{background:#155c42}
  .header{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:20px;padding-bottom:22px;border-bottom:3px solid #1a6b4e;margin-bottom:26px}
  .company-brand{display:flex;align-items:center;gap:10px;margin-bottom:8px}
  .company-brand img{height:48px;width:auto;flex-shrink:0}
  .company-brand-name{font-family:'Great Vibes',Georgia,serif;font-size:2rem;line-height:1}
  .company p{margin:2px 0;font-size:.81rem;color:#555}
  .receipt-meta{text-align:right;min-width:0;flex-shrink:0}
  .receipt-meta h2{font-size:.9rem;font-weight:700;color:#1a1a1a;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px}
  .receipt-meta p{margin:3px 0;font-size:.83rem;color:#444}
  .receipt-meta .ref{font-size:.68rem;color:#bbb;font-family:monospace;word-break:break-all;max-width:200px;display:inline-block}
  .section-title{font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 8px}
  .info-row{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px}
  .info-box{flex:1;min-width:180px;background:#f8faf9;border:1px solid #e2ede8;border-radius:8px;padding:14px 16px;font-size:.86rem}
  .info-box p{margin:3px 0}
  .table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:0}
  table.items{width:100%;border-collapse:collapse;font-size:.86rem;min-width:480px}
  table.items thead th{background:#1a6b4e;color:#fff;padding:10px 8px;text-align:left;font-size:.79rem;font-weight:600;white-space:nowrap}
  table.items thead th.r{text-align:right} table.items thead th.c{text-align:center}
  table.items tbody tr:nth-child(even){background:#f8faf9}
  table.items tbody td{padding:8px;border-bottom:1px solid #eee;vertical-align:top}
  .totals-wrap{display:flex;justify-content:flex-end;margin-top:18px}
  .totals-table{width:100%;max-width:320px;border-collapse:collapse;font-size:.87rem}
  .totals-table td{padding:5px 8px}
  .totals-table .total-row td{font-weight:700;font-size:1rem;padding-top:10px;border-top:2px solid #1a6b4e}
  .tva-wrap{margin-top:26px;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .tva-table{width:100%;border-collapse:collapse;font-size:.83rem;min-width:320px}
  .tva-table th{background:#f0f0f0;padding:7px 8px;text-align:left;color:#555;font-weight:600;font-size:.79rem;white-space:nowrap}
  .tva-table th.r{text-align:right}
  .tva-table td{padding:5px 8px;border-bottom:1px solid #eee}
  .tva-table .total-row td{font-weight:700;background:#f8f8f8}
  .footer{margin-top:30px;padding-top:18px;border-top:1px solid #eee;font-size:.74rem;color:#aaa;line-height:1.7}
  @media(max-width:600px){
    .receipt{padding:20px 14px}
    .header{flex-direction:column}
    .receipt-meta{text-align:left}
    .receipt-meta .ref{max-width:100%}
  }
  @media print{
    body{background:#fff;padding:0}
    .receipt{box-shadow:none;border-radius:0;padding:16px}
    .btn-print{display:none!important}
  }
</style>
</head>
<body>
<button class="btn-print" id="btn-print">🖨️ Imprimer / Télécharger en PDF</button>
<div class="receipt">
  <div class="header">
    <div class="company">
      <div class="company-brand">
        <img src="${process.env.SITE_URL}/images/svg/logo_panuozzo_transparent.png" alt="Logo PANUOZZO">
        <span class="company-brand-name"><span style="color:#dc2626">Pan</span><span style="color:#1c1917">uoz</span><span style="color:#1a6b4e">zo</span></span>
      </div>
      <p>Pizza au feu de bois</p>
      <p>30 Av. Jean Moulin — 78380 Bougival</p>
      <p>Tél : 01 75 26 91 20</p>
      <p style="margin-top:7px">SIRET : 988 030 797 00019</p>
      <p>Code APE : 56.10C — Restauration rapide</p>
      <p>N° TVA intracommunautaire : FR62 988 030 797</p>
    </div>
    <div class="receipt-meta">
      <h2>Reçu de paiement</h2>
      <p><strong>N° ${receiptNum}</strong></p>
      <p>Date : ${dateStr} à ${timeStr}</p>
      <p>Mode : ${modeLabel}</p>
      <p>Paiement : Carte bancaire (Stripe)</p>
      <p class="ref">Réf. ${escHtml(order.id)}</p>
    </div>
  </div>

  <div class="info-row">
    <div class="info-box">
      <p class="section-title">Vendeur</p>
      <p><strong>PANUOZZO</strong></p>
      <p>30 Av. Jean Moulin, 78380 Bougival</p>
      <p>contact@panuozzo-bougival.fr</p>
    </div>
    ${clientBox}
  </div>

  <div class="table-scroll">
  <table class="items">
    <thead>
      <tr>
        <th>Désignation</th>
        <th class="c">Qté</th>
        <th class="r">PU TTC</th>
        <th class="c">TVA</th>
        <th class="r">Total TTC</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>
  </div>

  <div class="totals-wrap">
    <table class="totals-table">
      ${promoRow}
      <tr><td style="color:#555">Total HT</td><td style="text-align:right">${totalHT.toFixed(2)} €</td></tr>
      <tr><td style="color:#555">Total TVA</td><td style="text-align:right">${totalTVA.toFixed(2)} €</td></tr>
      <tr class="total-row"><td>Total TTC</td><td style="text-align:right">${order.total.toFixed(2)} €</td></tr>
    </table>
  </div>

  <div class="tva-wrap">
    <p class="section-title">Récapitulatif TVA</p>
    <table class="tva-table">
      <thead>
        <tr>
          <th>Taux TVA</th>
          <th class="r">Base HT</th>
          <th class="r">Montant TVA</th>
          <th class="r">Total TTC</th>
        </tr>
      </thead>
      <tbody>
        ${tvaRecapRows}
        <tr class="total-row">
          <td>Total</td>
          <td style="text-align:right">${totalHT.toFixed(2)} €</td>
          <td style="text-align:right">${totalTVA.toFixed(2)} €</td>
          <td style="text-align:right">${order.total.toFixed(2)} €</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    <p>TVA acquittée sur les débits · Restauration rapide (Code APE 56.10C)</p>
    <p>Taux appliqués : 10% sur plats cuisinés à emporter/livrer · 5,5% sur boissons non alcoolisées</p>
    <p>Ce document tient lieu de facture simplifiée conformément à l'article 242 nonies A de l'annexe II du CGI.</p>
    <p>PANUOZZO — 30 Av. Jean Moulin, 78380 Bougival — SIRET 988 030 797 00019 — N° TVA FR62 988 030 797</p>
  </div>
</div>
<script>document.getElementById('btn-print').addEventListener('click',function(){window.print();});</script>
</body>
</html>`;
}

// ── Reçu fiscal client ────────────────────────────────────
app.get('/api/receipt/:sessionId', rlReceipt, (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || !/^cs_(test|live)_/.test(sessionId)) {
    return res.status(400).send('Identifiant invalide');
  }
  const order = loadOrders().find(o => o.id === sessionId);
  if (!order) return res.status(404).send('Reçu introuvable');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // CSP assouplie pour cette page standalone (print via script inline)
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' https: data:;"
  );
  res.send(generateReceiptHtml(order));
});

// ── Confirmation après paiement (appelé par merci.html) ───
app.get('/api/confirm', rlCheckout, async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id manquant' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Paiement non complété' });
    }
    await processOrder(session);
    res.json({ ok: true });
  } catch (err) {
    console.error('Confirm error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Vérification horaires d'ouverture ────────────────────
function isRestaurantOpen() {
  const now  = new Date();
  const day  = now.getDay(); // 0=dim, 1=lun, ..., 6=sam
  const hm   = now.getHours() * 60 + now.getMinutes();
  if (day === 1) return false; // lundi fermé
  return (hm >= 11 * 60 && hm < 14 * 60 + 30) ||
         (hm >= 18 * 60 && hm < 23 * 60);
}

// ── Vérification éligibilité promo ───────────────────────
app.get('/api/check-promo', rlCheckout, (req, res) => {
  const email = (req.query.email || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ eligible: false });
  res.json({ eligible: isPromoEligible(email) });
});

// ── Stripe Checkout Session ───────────────────────────────
app.post('/api/checkout', rlCheckout, async (req, res) => {
  try {
    const { items, delivery, applyPromo, promoEmail } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Panier vide' });
    }

    // Validation des articles côté serveur (évite les prix manipulés)
    for (const item of items) {
      if (typeof item.name !== 'string' || !item.name.trim()) {
        return res.status(400).json({ error: 'Article invalide' });
      }
      const price = parseFloat(item.price);
      // price=0 autorisé (articles offerts dans les formules)
      // 0 < price < 2.50 impossible (aucun article légitime ne coûte entre 1 centime et 2,50€)
      if (isNaN(price) || price < 0 || (price > 0 && price < 2.50) || price > 150) {
        return res.status(400).json({ error: 'Prix invalide' });
      }
      const qty = parseInt(item.qty ?? 1, 10);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ error: 'Quantité invalide' });
      }
    }

    // Minimum de commande : 20€
    const orderTotal = items.reduce((s, i) => s + parseFloat(i.price) * parseInt(i.qty || 1, 10), 0);
    if (orderTotal < 20) {
      return res.status(400).json({ error: 'Montant minimum de commande : 20€' });
    }

    if (!isRestaurantOpen()) {
      return res.status(403).json({ error: 'Le restaurant est actuellement fermé. Les commandes ne sont pas acceptées.' });
    }

    const line_items = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: String(item.name).trim().slice(0, 250),
          ...((item.description || item.desc) ? { description: String(item.description || item.desc).slice(0, 500) } : {}),
          // item.image non transmis — évite SSRF via Stripe
        },
        unit_amount: Math.round(parseFloat(item.price) * 100),
      },
      quantity: parseInt(item.qty || 1, 10),
    }));

    // Vérification côté serveur de l'éligibilité promo — atomique via mutex
    let promoApplied = false;
    if (applyPromo && promoEmail) {
      await fileMutex.run(() => {
        if (isPromoEligible(promoEmail)) {
          markPromoUsed(promoEmail);
          promoApplied = true;
        }
      });
    }
    let discounts = undefined;
    if (promoApplied) {
      const couponId = await getPromoCouponId();
      discounts = [{ coupon: couponId }];
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${process.env.SITE_URL}/merci.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.SITE_URL}/#commander`,
      locale: 'fr',
      ...(discounts ? { discounts } : {}),
      metadata: {
        source:      'site_panuozzo',
        delivery:    JSON.stringify(delivery || {}),
        promoEmail:  promoApplied ? promoEmail.trim().toLowerCase() : '',
      },
    });

    // Sauvegarder les items complets (avec desc/added/removed) — persisté sur disque
    savePendingItem(session.id, items);

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

// ── SSE stream pour la tablette ────────────────────────────
app.get('/api/orders/stream', tabletteAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // désactive le buffering Nginx
  res.flushHeaders();

  sseClients.add(res);

  // Envoyer les commandes existantes à la connexion
  const orders = loadOrders();
  res.write(`event: init\ndata: ${JSON.stringify(orders)}\n\n`);

  // Heartbeat toutes les 25s pour maintenir la connexion (évite le timeout Nginx)
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ── API commandes ─────────────────────────────────────────
app.get('/api/orders', tabletteAuth, (req, res) => {
  res.json(loadOrders());
});

// Réimpression manuelle depuis la tablette
app.post('/api/orders/:id/print', tabletteAuth, (req, res) => {
  const order = loadOrders().find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (!process.env.PRINTER_HOST) return res.status(503).json({ error: 'Imprimante non configurée' });
  printOrder(order);
  res.json({ ok: true });
});

app.patch('/api/orders/:id/status', express.json(), tabletteAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const valid = ['nouveau', 'en_preparation', 'pret', 'livre'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Statut invalide' });

  let order = null;
  await fileMutex.run(() => {
    const orders = loadOrders();
    order = orders.find(o => o.id === id);
    if (!order) return;
    order.status = status;
    saveOrders(orders);
  });
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });

  pushSSE('status-update', { id, status });
  res.json({ ok: true });

  // Email client au changement de statut
  const prenom = escHtml(order.delivery?.firstname || order.delivery?.prenom || '');
  const isLivraison = order.delivery?.mode === 'livraison';
  const customerEmail = order.customerEmail;

  if (customerEmail) {
    let subject = null, html = null;

    if (status === 'en_preparation') {
      subject = '👨‍🍳 Votre commande PANUOZZO est en préparation';
      html = `
        ${emailBrandBlock()}
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <div style="background:#1a6b4e;padding:16px 28px">
            <h1 style="color:#fff;margin:0;font-size:1.2rem">👨‍🍳 En cours de préparation</h1>
          </div>
          <div style="padding:24px 28px;background:#fff">
            <p>Bonjour <strong>${prenom}</strong>,</p>
            <p>Bonne nouvelle ! Votre commande est en cours de préparation. Nos pizzaïolos sont à l'œuvre 🍕</p>
            <p style="color:#666;font-size:.88rem">⏱ Plus que quelques minutes de patience...</p>
            <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
            <p style="color:#999;font-size:.8rem;margin:0">PANUOZZO — 30 Av. Jean Moulin, 78380 Bougival · 01 75 26 91 20</p>
          </div>
        </div>`;
    } else if (status === 'pret') {
      if (isLivraison) {
        subject = '🛵 Votre commande PANUOZZO est en route !';
        html = `
          ${emailBrandBlock()}
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <div style="background:#2563eb;padding:16px 28px">
              <h1 style="color:#fff;margin:0;font-size:1.2rem">🛵 Votre commande arrive !</h1>
            </div>
            <div style="padding:24px 28px;background:#fff">
              <p>Bonjour <strong>${prenom}</strong>,</p>
              <p>Votre commande est prête et notre livreur est en route vers chez vous !</p>
              <p style="color:#666;font-size:.88rem">🏠 Livraison à ${escHtml(order.delivery?.address || order.delivery?.adresse || 'votre adresse')}</p>
              <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
              <p style="color:#999;font-size:.8rem;margin:0">PANUOZZO — 30 Av. Jean Moulin, 78380 Bougival · 01 75 26 91 20</p>
            </div>
          </div>`;
      } else {
        subject = '✅ Votre commande PANUOZZO est prête !';
        html = `
          ${emailBrandBlock()}
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <div style="background:#d97706;padding:16px 28px">
              <h1 style="color:#fff;margin:0;font-size:1.2rem">✅ Commande prête à retirer !</h1>
            </div>
            <div style="padding:24px 28px;background:#fff">
              <p>Bonjour <strong>${prenom}</strong>,</p>
              <p>Votre commande est prête ! Vous pouvez venir la récupérer dès maintenant.</p>
              <p style="font-weight:700">📍 30 Av. Jean Moulin, 78380 Bougival</p>
              <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
              <p style="color:#999;font-size:.8rem;margin:0">PANUOZZO — 01 75 26 91 20</p>
            </div>
          </div>`;
      }
    } else if (status === 'livre') {
      if (isLivraison) {
        subject = '🙏 Merci pour votre commande PANUOZZO !';
        html = `
          ${emailBrandBlock()}
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <div style="background:#1a6b4e;padding:16px 28px">
              <h1 style="color:#fff;margin:0;font-size:1.2rem">🙏 Merci pour votre confiance !</h1>
            </div>
            <div style="padding:24px 28px;background:#fff">
              <p>Bonjour <strong>${prenom}</strong>,</p>
              <p>Nous espérons que votre commande vous a régalé ! 🍕</p>
              <p>Toute l'équipe PANUOZZO vous remercie de votre confiance et vous donne rendez-vous très bientôt.</p>
              <p style="color:#666;font-size:.88rem">N'hésitez pas à nous laisser un avis — cela nous aide énormément 🌟</p>
              <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
              <p style="color:#999;font-size:.8rem;margin:0">PANUOZZO — 30 Av. Jean Moulin, 78380 Bougival · 01 75 26 91 20</p>
            </div>
          </div>`;
      } else {
        subject = '🙏 Merci pour votre visite chez PANUOZZO !';
        html = `
          ${emailBrandBlock()}
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <div style="background:#1a6b4e;padding:16px 28px">
              <h1 style="color:#fff;margin:0;font-size:1.2rem">🙏 Merci pour votre confiance !</h1>
            </div>
            <div style="padding:24px 28px;background:#fff">
              <p>Bonjour <strong>${prenom}</strong>,</p>
              <p>Nous espérons que votre commande vous a régalé ! 🍕</p>
              <p>Toute l'équipe PANUOZZO vous remercie de votre visite et vous donne rendez-vous très bientôt.</p>
              <p style="color:#666;font-size:.88rem">N'hésitez pas à nous laisser un avis — cela nous aide énormément 🌟</p>
              <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
              <p style="color:#999;font-size:.8rem;margin:0">PANUOZZO — 30 Av. Jean Moulin, 78380 Bougival · 01 75 26 91 20</p>
            </div>
          </div>`;
      }
    }

    if (subject && html) {
      sendEmail(customerEmail, subject, html).catch(err => console.error('Email statut error:', err.message));
    }
  }
});

// ── Auth tablette ─────────────────────────────────────────
app.post('/api/auth/tablette', rlAuth, (req, res) => {
  const { password } = req.body;
  const tExpected = process.env.TABLETTE_PASSWORD;
  const aExpected = process.env.ADMIN_PASSWORD;
  if (
    (tExpected && timingSafeEquals(String(password || ''), tExpected)) ||
    (aExpected && timingSafeEquals(String(password || ''), aExpected))
  ) {
    const token = createSession('tablette');
    res.json({ ok: true, token });
  } else {
    res.json({ ok: false });
  }
});

// ── Auth admin ────────────────────────────────────────────
app.post('/api/auth/admin', rlAuth, (req, res) => {
  const { password } = req.body;
  const expected = process.env.ADMIN_PASSWORD || process.env.TABLETTE_PASSWORD;
  if (expected && timingSafeEquals(String(password || ''), expected)) {
    const token = createSession('admin');
    res.json({ ok: true, token });
  } else {
    res.json({ ok: false });
  }
});

// ── Vérification de token (auto-login frontend) ───────────
app.get('/api/auth/verify', (req, res) => {
  const token = req.headers['x-tablette-password'] || req.headers['x-admin-password'];
  const s = token && _sessions.get(token);
  if (s && Date.now() < s.expiresAt) return res.json({ ok: true, role: s.role });
  res.status(401).json({ ok: false });
});

// Middleware auth admin — vérifie le token de session (rôle admin)
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-password'];
  const s = token && _sessions.get(token);
  if (s && Date.now() < s.expiresAt && s.role === 'admin') return next();
  res.status(401).json({ error: 'Non autorisé' });
}

// Middleware auth tablette — accepte tout token valide (tablette ou admin)
// Accepte aussi req.query.token pour les connexions SSE (EventSource ne supporte pas les headers)
function tabletteAuth(req, res, next) {
  const token = req.headers['x-tablette-password'] || req.headers['x-admin-password'] || req.query.token;
  const s = token && _sessions.get(token);
  if (s && Date.now() < s.expiresAt) return next();
  res.status(401).json({ error: 'Non autorisé' });
}

// ── Stats admin ───────────────────────────────────────────
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const orders = loadOrders();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // Aujourd'hui
  const todayOrders = orders.filter(o => o.createdAt.startsWith(todayStr));
  const todayRevenue = todayOrders.reduce((s, o) => s + (o.total || 0), 0);

  // Ce mois
  const monthStr = now.toISOString().slice(0, 7);
  const monthOrders = orders.filter(o => o.createdAt.startsWith(monthStr));
  const monthRevenue = monthOrders.reduce((s, o) => s + (o.total || 0), 0);

  // Total
  const totalRevenue = orders.reduce((s, o) => s + (o.total || 0), 0);
  const avgBasket = orders.length ? totalRevenue / orders.length : 0;

  // Par statut
  const byStatus = { nouveau: 0, en_preparation: 0, pret: 0, livre: 0 };
  orders.forEach(o => { if (byStatus[o.status] !== undefined) byStatus[o.status]++; });

  // Par mode
  const byMode = { livraison: 0, emporter: 0 };
  orders.forEach(o => {
    const m = o.delivery?.mode;
    if (m === 'livraison') byMode.livraison++;
    else byMode.emporter++;
  });

  // CA par jour sur 30 jours
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const dayOrders = orders.filter(o => o.createdAt.startsWith(ds));
    last30.push({
      date:    ds,
      revenue: parseFloat(dayOrders.reduce((s, o) => s + (o.total || 0), 0).toFixed(2)),
      count:   dayOrders.length,
    });
  }

  // Top articles
  const itemCount = {};
  orders.forEach(o => {
    (o.items || []).forEach(i => {
      const key = i.name;
      if (!itemCount[key]) itemCount[key] = { name: key, qty: 0, revenue: 0 };
      itemCount[key].qty     += (i.qty || 1);
      itemCount[key].revenue += (i.price || 0) * (i.qty || 1);
    });
  });
  const topItems = Object.values(itemCount)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 8)
    .map(i => ({ ...i, revenue: parseFloat(i.revenue.toFixed(2)) }));

  res.json({
    today:        { revenue: parseFloat(todayRevenue.toFixed(2)), orders: todayOrders.length },
    month:        { revenue: parseFloat(monthRevenue.toFixed(2)), orders: monthOrders.length },
    total:        { revenue: parseFloat(totalRevenue.toFixed(2)), orders: orders.length },
    avgBasket:    parseFloat(avgBasket.toFixed(2)),
    byStatus,
    byMode,
    last30,
    topItems,
    serverTime:   new Date().toISOString(),
  });
});

// ── Liste commandes paginée + filtres ─────────────────────
app.get('/api/admin/orders', adminAuth, (req, res) => {
  let orders = loadOrders();
  const { status, mode, search, from, to, page = 1, limit = 25, sort = 'desc' } = req.query;
  const safePage  = Math.max(1, parseInt(page)  || 1);
  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 25), 100);

  if (status)  orders = orders.filter(o => o.status === status);
  if (mode)    orders = orders.filter(o => o.delivery?.mode === mode);
  if (from)    orders = orders.filter(o => o.createdAt >= from);
  if (to)      orders = orders.filter(o => o.createdAt <= to + 'T23:59:59');
  if (search) {
    const q = search.toLowerCase();
    orders = orders.filter(o => {
      const d = o.delivery || {};
      return (
        (d.firstname || d.prenom || '').toLowerCase().includes(q) ||
        (d.lastname  || d.nom   || '').toLowerCase().includes(q) ||
        (d.phone     || d.telephone || '').includes(q) ||
        (o.customerEmail || '').toLowerCase().includes(q)
      );
    });
  }

  orders.sort((a, b) => sort === 'asc'
    ? new Date(a.createdAt) - new Date(b.createdAt)
    : new Date(b.createdAt) - new Date(a.createdAt)
  );

  const total     = orders.length;
  const pages     = Math.ceil(total / safeLimit) || 1;
  const offset    = (safePage - 1) * safeLimit;
  const paginated = orders.slice(offset, offset + safeLimit);

  res.json({ orders: paginated, total, pages, page: safePage });
});

// ── Export CSV ────────────────────────────────────────────
app.get('/api/admin/export/csv', adminAuth, (req, res) => {
  const orders = loadOrders();
  const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;

  const rows = [
    ['Date','N° commande','Statut','Client','Email','Téléphone','Mode','Adresse','Articles','Total (€)'].map(escape).join(','),
    ...orders.map(o => {
      const d = o.delivery || {};
      const name = `${d.firstname || d.prenom || ''} ${d.lastname || d.nom || ''}`.trim();
      const addr = [d.address || d.adresse, d.floor || d.etage, d.appt, d.building || d.batiment, d.code || d.codeAcces].filter(Boolean).join(' ');
      const items = (o.items || []).map(i => `${i.qty || 1}x ${i.name}`).join(' | ');
      return [
        o.createdAt.slice(0, 16).replace('T', ' '),
        String(o.orderNumber).slice(-6),
        o.status,
        name,
        o.customerEmail || '',
        d.phone || d.telephone || '',
        d.mode || '',
        addr,
        items,
        (o.total || 0).toFixed(2),
      ].map(escape).join(',');
    }),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="panuozzo-commandes-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('\uFEFF' + rows.join('\r\n')); // BOM UTF-8 pour Excel
});

// ── Supprimer commande ────────────────────────────────────
app.delete('/api/admin/orders/:id', adminAuth, (req, res) => {
  const orders = loadOrders();
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Introuvable' });
  orders.splice(idx, 1);
  saveOrders(orders);
  res.json({ ok: true });
});

// ── Proxy My Thai admin API ────────────────────────────────
// Permet au dashboard unifié d'interroger mythai sans CORS
const MYTHAI_PORT = parseInt(process.env.MYTHAI_PORT) || 3006;
let _mythaiToken = null;
let _mythaiTokenExpiry = 0;

function getMythaiToken() {
  return new Promise((resolve) => {
    if (_mythaiToken && Date.now() < _mythaiTokenExpiry) return resolve(_mythaiToken);
    const pwd  = process.env.MYTHAI_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
    const body = JSON.stringify({ password: pwd });
    const req  = http.request(
      { hostname: 'localhost', port: MYTHAI_PORT, path: '/api/auth/admin', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const d = JSON.parse(raw);
            if (d.ok) { _mythaiToken = d.token; _mythaiTokenExpiry = Date.now() + 7 * 3600_000; }
          } catch { /* ignore */ }
          resolve(_mythaiToken);
        });
      }
    );
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

function proxyToMythai(apiPath, method, body, extraHeaders, res) {
  const data = (body && Object.keys(body).length) ? JSON.stringify(body) : null;
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (data) headers['Content-Length'] = Buffer.byteLength(data);
  const req = http.request(
    { hostname: 'localhost', port: MYTHAI_PORT, path: apiPath, method, headers },
    (proxyRes) => {
      const ct = proxyRes.headers['content-type'] || '';
      res.status(proxyRes.statusCode);
      if (ct.includes('text/csv')) {
        res.setHeader('Content-Type', ct);
        const cd = proxyRes.headers['content-disposition'];
        if (cd) res.setHeader('Content-Disposition', cd);
        proxyRes.pipe(res);
      } else {
        let raw = '';
        proxyRes.on('data', c => raw += c);
        proxyRes.on('end', () => {
          try { res.json(JSON.parse(raw)); } catch { res.status(500).json({ error: 'Parse error' }); }
        });
      }
    }
  );
  req.on('error', () => res.status(503).json({ error: 'My Thai server unavailable' }));
  if (data) req.write(data);
  req.end();
}

// SSE en temps réel pour mythai (proxy stream)
app.get('/api/proxy/mythai/orders/stream', adminAuth, async (req, res) => {
  const token = await getMythaiToken();
  if (!token) return res.status(503).json({ error: 'My Thai server unavailable' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const pr = http.request(
    { hostname: 'localhost', port: MYTHAI_PORT,
      path: `/api/orders/stream?token=${encodeURIComponent(token)}`,
      method: 'GET', headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' } },
    (proxyRes) => { proxyRes.pipe(res); proxyRes.on('end', () => res.end()); }
  );
  pr.on('error', () => { try { res.write('event: error\ndata: {}\n\n'); res.end(); } catch { /* closed */ } });
  req.on('close', () => pr.destroy());
  pr.end();
});

// Routes admin mythai (stats, orders, export, delete)
app.use('/api/proxy/mythai', adminAuth, async (req, res) => {
  const token = await getMythaiToken();
  if (!token) return res.status(503).json({ error: 'My Thai server unavailable' });
  proxyToMythai(`/api/admin${req.url}`, req.method, req.body,
    { 'x-admin-password': token }, res);
});

// ── Fichiers statiques ────────────────────────────────────
// tablette.html et admin.html servis sans cache pour toujours avoir le dernier code
app.get('/tablette.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'tablette.html'));
});
app.get('/admin.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.use(express.static(path.join(__dirname), { maxAge: '1h', etag: true }));

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Initialisation des caches depuis le disque ────────────
try { _ordersCache       = JSON.parse(fs.readFileSync(ORDERS_FILE,        'utf8')); }
catch { _ordersCache       = []; fs.writeFileSync(ORDERS_FILE,        '[]'); }
try { _promoUsedCache    = JSON.parse(fs.readFileSync(PROMO_USED_FILE,    'utf8')); }
catch { _promoUsedCache    = []; fs.writeFileSync(PROMO_USED_FILE,    '[]'); }
try { _pendingItemsCache = JSON.parse(fs.readFileSync(PENDING_ITEMS_FILE, 'utf8')); }
catch { _pendingItemsCache = {}; fs.writeFileSync(PENDING_ITEMS_FILE, '{}'); }

// ── Démarrage ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🍕 PANUOZZO server running on port ${PORT}`);
  console.log(`   → ${process.env.SITE_URL}`);
});
