require('dotenv').config();
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const https    = require('https');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3005;
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// ── Persistance commandes ──────────────────────────────────
function loadOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); }
  catch { return []; }
}
function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
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

// ── Webhook Stripe (raw body AVANT express.json) ──────────
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  if (process.env.STRIPE_WEBHOOK_SECRET) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature error:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // Dev : pas de secret configuré, on parse sans vérification
    try { event = JSON.parse(req.body.toString()); }
    catch { return res.status(400).send('Invalid JSON'); }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      // Récupérer les articles depuis Stripe
      const li = await stripe.checkout.sessions.listLineItems(session.id, { limit: 50 });
      const items = li.data.map(i => ({
        name:  i.description,
        qty:   i.quantity,
        price: i.amount_total / 100,
      }));

      // Infos livraison depuis metadata
      let delivery = {};
      try { delivery = JSON.parse(session.metadata?.delivery || '{}'); } catch {}

      const order = {
        id:            session.id,
        orderNumber:   Date.now(),
        createdAt:     new Date().toISOString(),
        status:        'nouveau',
        customerEmail: session.customer_details?.email || '',
        items,
        delivery,
        total:         session.amount_total / 100,
      };

      // Sauvegarde + push tablette
      const orders = loadOrders();
      orders.unshift(order);
      saveOrders(orders);
      pushSSE('new-order', order);

      // Texte de la commande
      const itemsList   = items.map(i => `• ${i.qty}x ${i.name}`).join('\n');
      const itemsHtml   = items.map(i => `<tr><td style="padding:5px 0">${i.qty}× ${i.name}</td><td align="right">${i.price.toFixed(2)}€</td></tr>`).join('');
      const modeLabel   = delivery.mode === 'livraison' ? 'Livraison' : 'Retrait sur place';
      const addrLine    = [delivery.adresse, delivery.etage && `Étage ${delivery.etage}`, delivery.batiment && `Bât. ${delivery.batiment}`, delivery.codeAcces && `Code ${delivery.codeAcces}`].filter(Boolean).join(', ');

      // ── SMS client ──
      if (delivery.telephone) {
        await sendSMS(delivery.telephone,
          `🍕 PANUOZZO — Commande confirmée !\n${itemsList}\nMode : ${modeLabel}\nTemps estimé : ~30 min. Merci !`
        );
      }

      // ── Email client ──
      if (order.customerEmail) {
        await sendEmail(order.customerEmail, '🍕 Votre commande PANUOZZO est confirmée !', `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
            <div style="background:#1a6b4e;padding:24px 32px">
              <h1 style="color:#fff;margin:0;font-size:1.5rem">🍕 Commande confirmée !</h1>
            </div>
            <div style="padding:28px 32px">
              <p style="margin-top:0">Bonjour <strong>${delivery.prenom || ''}</strong>,</p>
              <p>Votre commande est bien enregistrée et en cours de préparation.</p>
              <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:.92rem">
                ${itemsHtml}
                <tr><td colspan="2" style="padding:4px 0"><hr style="border:none;border-top:1px solid #eee"/></td></tr>
                <tr><td><strong>Total payé</strong></td><td align="right"><strong>${order.total.toFixed(2)}€</strong></td></tr>
              </table>
              <p><strong>Mode :</strong> ${modeLabel}${delivery.mode === 'livraison' && addrLine ? ` — ${addrLine}` : ''}</p>
              <p style="color:#666;font-size:.88rem">⏱ Temps estimé : ~30 minutes</p>
              <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
              <p style="color:#999;font-size:.8rem;margin:0">PANUOZZO — 30 Av. Jean Moulin, 78380 Bougival · 01 75 26 91 20</p>
            </div>
          </div>
        `);
      }

      // ── Email admin ──
      if (process.env.ADMIN_EMAIL) {
        await sendEmail(process.env.ADMIN_EMAIL,
          `🔔 Nouvelle commande — ${delivery.prenom || ''} ${delivery.nom || ''} — ${order.total.toFixed(2)}€`,
          `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
            <div style="background:#dc2626;padding:20px 28px">
              <h1 style="color:#fff;margin:0;font-size:1.3rem">🔔 Nouvelle commande</h1>
            </div>
            <div style="padding:24px 28px">
              <table style="width:100%;font-size:.9rem;margin-bottom:16px">
                <tr><td style="padding:4px 0;color:#666;width:130px">Client</td><td><strong>${delivery.prenom || ''} ${delivery.nom || ''}</strong></td></tr>
                <tr><td style="padding:4px 0;color:#666">Téléphone</td><td>${delivery.telephone || '—'}</td></tr>
                <tr><td style="padding:4px 0;color:#666">Mode</td><td><strong>${modeLabel}</strong></td></tr>
                ${delivery.mode === 'livraison' && addrLine ? `<tr><td style="padding:4px 0;color:#666">Adresse</td><td>${addrLine}</td></tr>` : ''}
                ${delivery.appt ? `<tr><td style="padding:4px 0;color:#666">Appartement</td><td>${delivery.appt}</td></tr>` : ''}
                ${delivery.instructions ? `<tr><td style="padding:4px 0;color:#666">Instructions</td><td>${delivery.instructions}</td></tr>` : ''}
              </table>
              <h3 style="margin-bottom:8px">Articles</h3>
              <table style="width:100%;border-collapse:collapse;font-size:.9rem">
                ${itemsHtml}
                <tr><td colspan="2" style="padding:4px 0"><hr style="border:none;border-top:1px solid #eee"/></td></tr>
                <tr><td><strong>Total</strong></td><td align="right"><strong>${order.total.toFixed(2)}€</strong></td></tr>
              </table>
              <p style="color:#999;font-size:.78rem;margin-top:16px">Session Stripe : ${session.id}</p>
            </div>
          </div>
        `);
      }

      console.log(`✅ Commande #${order.orderNumber} traitée — ${order.total}€`);
    } catch (err) {
      console.error('Order processing error:', err.message);
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// ── Stripe Checkout Session ───────────────────────────────
app.post('/api/checkout', async (req, res) => {
  try {
    const { items, delivery } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Panier vide' });
    }

    const line_items = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.name,
          ...((item.description || item.desc) ? { description: item.description || item.desc } : {}),
          ...(item.image ? { images: [item.image] } : {}),
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.qty || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${process.env.SITE_URL}/merci.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.SITE_URL}/#commander`,
      locale: 'fr',
      metadata: {
        source:   'site_panuozzo',
        delivery: JSON.stringify(delivery || {}),
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

// ── SSE stream pour la tablette ────────────────────────────
app.get('/api/orders/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  // Envoyer les commandes existantes à la connexion
  const orders = loadOrders();
  res.write(`event: init\ndata: ${JSON.stringify(orders)}\n\n`);

  req.on('close', () => sseClients.delete(res));
});

// ── API commandes ─────────────────────────────────────────
app.get('/api/orders', (req, res) => {
  res.json(loadOrders());
});

app.patch('/api/orders/:id/status', express.json(), (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const valid = ['nouveau', 'en_preparation', 'pret', 'livre'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Statut invalide' });

  const orders = loadOrders();
  const order = orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });

  order.status = status;
  saveOrders(orders);
  pushSSE('status-update', { id, status });
  res.json({ ok: true });
});

// ── Auth tablette ─────────────────────────────────────────
app.post('/api/auth/tablette', (req, res) => {
  const { password } = req.body;
  const expected = process.env.TABLETTE_PASSWORD;
  if (!expected || password === expected) {
    res.json({ ok: true });
  } else {
    res.json({ ok: false });
  }
});

// ── Fichiers statiques ────────────────────────────────────
app.use(express.static(path.join(__dirname), { maxAge: '7d', etag: true }));

// SPA fallback
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Démarrage ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🍕 PANUOZZO server running on port ${PORT}`);
  console.log(`   → ${process.env.SITE_URL}`);
});
