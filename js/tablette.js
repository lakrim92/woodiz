  // ── Service Worker (PWA) ─────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/tablette-sw.js').catch(() => {});
  }

  // ── Audio Context (débloqué après geste utilisateur) ─────
  let audioCtx = null;
  function unlockAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch {}
  }
  document.addEventListener('click', unlockAudio, { once: true });

  // ── Auth ─────────────────────────────────────────────────
  const SESSION_KEY = 'panuozzo_tablette_auth';
  let tablettePwd = '';

  // Escape HTML — prevent XSS from client-submitted order data
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function checkLogin() {
    unlockAudio(); // débloquer l'audio dès le premier clic
    const pwd = document.getElementById('login-input').value;
    const err = document.getElementById('login-error');
    if (!pwd) { err.textContent = 'Entrez le mot de passe'; return; }
    // Vérifie via l'API (le serveur compare avec TABLETTE_PASSWORD)
    fetch('/api/auth/tablette', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        tablettePwd = data.token;
        sessionStorage.setItem(SESSION_KEY, data.token);
        showApp();
      } else {
        err.textContent = 'Mot de passe incorrect';
        document.getElementById('login-input').value = '';
      }
    })
    .catch(() => { err.textContent = 'Erreur réseau'; });
  }

  document.getElementById('login-btn').addEventListener('click', checkLogin);
  document.getElementById('login-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') checkLogin();
  });

  function showApp() {
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    initSSE();
  }

  // Auto-login si token de session existant — vérification côté serveur
  const savedToken = sessionStorage.getItem(SESSION_KEY);
  if (savedToken) {
    fetch('/api/auth/verify', {
      headers: { 'x-tablette-password': savedToken },
    }).then(r => r.json()).then(data => {
      if (data.ok) { tablettePwd = savedToken; showApp(); }
      else { sessionStorage.removeItem(SESSION_KEY); }
    }).catch(() => {});
  }

  // ── State ─────────────────────────────────────────────────
  let orders = [];
  let currentFilter = 'all';

  const STATUS_LABELS = {
    nouveau:        '🟡 Nouvelle',
    en_preparation: '🔵 En préparation',
    pret:           '🟢 Prête',
    livre:          '⚫ Livrée',
  };

  // ── SSE ───────────────────────────────────────────────────
  let activeES   = null;
  let sseRetries = 0;
  const SSE_MAX  = 10;

  function initSSE() {
    if (sseRetries >= SSE_MAX) {
      setConn(false);
      console.warn('SSE : limite de reconnexions atteinte. Rechargez la page.');
      return;
    }
    if (activeES) { activeES.close(); activeES = null; }
    const es = new EventSource(`/api/orders/stream?token=${encodeURIComponent(tablettePwd)}`);
    activeES = es;

    es.addEventListener('init', e => {
      const fresh = JSON.parse(e.data);
      // Merge : ajouter les commandes inconnues (reçues pendant déconnexion)
      fresh.forEach(o => {
        if (!orders.find(x => x.id === o.id)) orders.unshift(o);
      });
      // Mettre à jour les statuts existants
      orders.forEach(o => {
        const updated = fresh.find(x => x.id === o.id);
        if (updated) o.status = updated.status;
      });
      // Trier par date décroissante
      orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      render();
      setConn(true);
    });

    es.addEventListener('new-order', e => {
      const order = JSON.parse(e.data);
      if (orders.find(o => o.id === order.id)) return;
      orders.unshift(order);
      render();
      playNotif();
      scheduleReminder(order.id);
      showToast(`🔔 Nouvelle commande — ${order.delivery?.prenom || ''} ${order.delivery?.nom || ''} — ${order.total?.toFixed(2)}€`);
      // Auto-impression du ticket à la réception
      printOrderTicket(order.id);
    });

    es.addEventListener('status-update', e => {
      const { id, status } = JSON.parse(e.data);
      const o = orders.find(o => o.id === id);
      if (o) {
        o.status = status;
        render();
        // Annuler le rappel si la commande est prise en charge
        if (status !== 'nouveau') {
          const t = _reminders.get(id);
          if (t) { clearTimeout(t); _reminders.delete(id); }
        }
      }
    });

    es.onerror = () => {
      setConn(false);
      if (es.readyState === EventSource.CLOSED) {
        sseRetries++;
        setTimeout(initSSE, 3000);
      }
    };
    es.onopen = () => { setConn(true); sseRetries = 0; };
  }

  function setConn(ok) {
    document.getElementById('conn-dot').style.background = ok ? '#4ade80' : '#dc2626';
    document.getElementById('conn-label').textContent = ok ? 'En direct' : 'Reconnexion…';
  }

  // ── Filtres ───────────────────────────────────────────────
  function setFilter(f, btn) {
    currentFilter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  }

  // Event delegation for filter buttons
  document.querySelector('.filters').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (btn) setFilter(btn.dataset.filter, btn);
  });

  // ── Rendu ─────────────────────────────────────────────────
  function render() {
    const grid = document.getElementById('orders-grid');

    // Badges
    ['nouveau','en_preparation','pret'].forEach(s => {
      const el = document.getElementById(`badge-${s}`);
      const n = orders.filter(o => o.status === s).length;
      if (el) el.textContent = n || '';
    });
    const allActive = orders.filter(o => o.status !== 'livre').length;
    const badgeAll = document.getElementById('badge-all');
    if (badgeAll) badgeAll.textContent = allActive || '';

    const filtered = currentFilter === 'all'
      ? orders.filter(o => o.status !== 'livre')
      : orders.filter(o => o.status === currentFilter);

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🍕</div>
          <p>Aucune commande ${currentFilter === 'all' ? 'active' : STATUS_LABELS[currentFilter]?.toLowerCase() || ''}</p>
        </div>`;
      return;
    }

    grid.innerHTML = filtered.map(order => orderCard(order)).join('');
  }

  function orderCard(order) {
    const d = order.delivery || {};
    const time = new Date(order.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const isLivraison = d.mode === 'livraison';

    const addrParts = [
      [esc(d.address || d.adresse), esc(d.zip), esc(d.city)].filter(Boolean).join(' ') || null,
      (d.floor || d.etage) && `Ét. ${esc(d.floor || d.etage)}`,
      d.appt && `Apt ${esc(d.appt)}`,
      (d.building || d.batiment) && `Bât. ${esc(d.building || d.batiment)}`,
      (d.code || d.codeAcces) && `Code : ${esc(d.code || d.codeAcces)}`,
    ].filter(Boolean);

    const itemsHtml = (order.items || []).map(i => {
      const removedHtml = (i.removed?.length)
        ? `<div class="item-detail item-removed">❌ Sans : ${i.removed.map(esc).join(', ')}</div>`
        : '';
      const addedHtml = (i.added?.length)
        ? `<div class="item-detail item-added">➕ ${i.added.map(a => `${a.qty > 1 ? a.qty + '× ' : ''}${esc(a.name)}`).join(', ')}</div>`
        : '';
      const meatHtml = i.meatChoice
        ? `<div class="item-detail item-meat">🥩 ${esc(i.meatChoice)}</div>`
        : '';
      const descHtml = (i.desc && !i.removed?.length && !i.added?.length && !i.meatChoice)
        ? `<div class="item-detail item-desc">${esc(i.desc)}</div>`
        : '';
      return `<div class="order-item">
        <div class="order-item-main"><span class="order-item-qty">${i.qty || 1}×</span>${esc(i.name)}<span class="order-item-price">${i.price?.toFixed(2)}€</span></div>
        ${descHtml}${meatHtml}${removedHtml}${addedHtml}
      </div>`;
    }).join('');

    const btnPrep  = `<button class="btn-status btn-preparation" data-action="updateStatus" data-id="${order.id}" data-status="en_preparation" ${order.status !== 'nouveau' ? 'disabled' : ''}>👨‍🍳 En prépa</button>`;
    const btnPret  = `<button class="btn-status btn-pret" data-action="updateStatus" data-id="${order.id}" data-status="pret" ${order.status !== 'en_preparation' ? 'disabled' : ''}>✅ Prête</button>`;
    const btnLivre = `<button class="btn-status btn-livre" data-action="updateStatus" data-id="${order.id}" data-status="livre" ${order.status !== 'pret' ? 'disabled' : ''}>${isLivraison ? '🛵 Livrée' : '🏠 Récupérée'}</button>`;
    const btnPrint = `<button class="btn-print" data-action="printOrder" data-id="${order.id}" title="Réimprimer le ticket">🖨️</button>`;

    return `
      <div class="order-card" id="card-${order.id}">
        <div class="order-card-header">
          <div>
            <div class="order-number">#${String(order.orderNumber).slice(-6)}</div>
            <div class="order-time">${time}</div>
          </div>
          <span class="status-pill status-${order.status}">${STATUS_LABELS[order.status] || order.status}</span>
        </div>
        <div class="order-card-body">
          <div class="order-client">
            <div class="order-client-name">${esc(d.firstname || d.prenom || '')} ${esc(d.lastname || d.nom || '')}</div>
            ${(d.phone || d.telephone) ? `<div class="order-client-phone">📞 ${esc(d.phone || d.telephone)}</div>` : ''}
          </div>
          <div class="order-mode ${isLivraison ? 'mode-livraison' : 'mode-emporter'}">
            ${isLivraison ? '🛵 Livraison' : '🏠 Retrait sur place'}
            ${isLivraison ? `<button class="btn-delivery-info" data-action="showDelivery" data-id="${order.id}">📍 Voir</button>` : ''}
          </div>
          ${isLivraison && addrParts.length ? `<div class="order-address">${addrParts.join(' · ')}</div>` : ''}
          <div class="order-items">${itemsHtml}</div>
          ${order.promoApplied ? `<div class="order-promo">🎉 Promo -10% appliquée — économie de ${(order.discount || 0).toFixed(2)}€</div>` : ''}
          <div class="order-total"><span>Total</span><span>${order.total?.toFixed(2)}€</span></div>
          ${d.instructions ? `<div class="order-instructions">💬 ${esc(d.instructions)}</div>` : ''}
        </div>
        <div class="order-card-footer">
          ${btnPrep}${btnPret}${btnLivre}${btnPrint}
        </div>
      </div>`;
  }

  // ── Impression ticket ─────────────────────────────────────
  async function printOrderTicket(id) {
    try {
      const res = await fetch(`/api/orders/${id}/print`, {
        method: 'POST',
        headers: { 'x-tablette-password': tablettePwd },
      });
      if (res.ok) showToast('🖨️ Ticket envoyé à l\'imprimante');
      else {
        const data = await res.json().catch(() => ({}));
        showToast(`❌ ${data.error || 'Erreur impression'}`, true);
      }
    } catch {
      showToast('❌ Erreur réseau impression', true);
    }
  }

  // ── Mise à jour statut ────────────────────────────────────
  async function updateStatus(id, status) {
    try {
      await fetch(`/api/orders/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-tablette-password': tablettePwd },
        body: JSON.stringify({ status }),
      });
      const o = orders.find(o => o.id === id);
      if (o) { o.status = status; render(); }
    } catch (err) {
      showToast('❌ Erreur de mise à jour', true);
    }
  }

  // ── Toast ─────────────────────────────────────────────────
  let toastTimer;
  function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.background = isError ? '#dc2626' : '#1a6b4e';
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
  }

  // ── Son notification ──────────────────────────────────────
  // Joue un accord de 3 oscillateurs simultanés — sawtooth + limiteur hard
  function playBips() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return; }
    }
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const comp = audioCtx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 0;
      comp.ratio.value = 20;
      comp.attack.value = 0.001;
      comp.release.value = 0.08;
      comp.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      // Fréquences 1760-2640Hz : plage maximale de sensibilité de l'oreille, coupe le bruit cuisine
      [1760, 2200, 2640].forEach(freq => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(comp);
        osc.frequency.value = freq;
        osc.type = 'sawtooth';
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.9, t + 0.005);
        gain.gain.setValueAtTime(0.9, t + 0.35);
        gain.gain.linearRampToValueAtTime(0, t + 0.45);
        osc.start(t);
        osc.stop(t + 0.46);
      });
    } catch {}
  }

  // 3 groupes de 3 sonneries avec pause entre les groupes
  function playNotif() {
    [0, 900, 1800, 3300, 4200, 5100, 6600, 7500, 8400].forEach(d => setTimeout(playBips, d));
  }

  // ── Modale infos livraison ────────────────────────────────
  function showDeliveryModal(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const d = order.delivery || {};

    const rows = [
      { label: 'Client',       value: `${d.firstname || d.prenom || ''} ${d.lastname || d.nom || ''}`.trim() || null, cls: '' },
      { label: 'Téléphone',    value: d.phone || d.telephone || null, cls: '' },
      { label: 'Adresse',      value: d.address || d.adresse || null, cls: 'address' },
      { label: 'Code postal',  value: d.zip || null, cls: '' },
      { label: 'Ville',        value: d.city || null, cls: '' },
      { label: 'Étage',        value: d.floor || d.etage || null, cls: '' },
      { label: 'Appartement',  value: d.appt || null, cls: '' },
      { label: 'Bâtiment',     value: d.building || d.batiment || null, cls: '' },
      { label: "Code d'accès", value: d.code || d.codeAcces || null, cls: '' },
      { label: 'Instructions', value: d.notes || d.instructions || null, cls: '' },
    ].filter(r => r.value);

    document.getElementById('delivery-modal-body').innerHTML = rows.map(r =>
      `<div class="delivery-row">
        <div class="delivery-row-label">${r.label}</div>
        <div class="delivery-row-value ${r.cls}">${esc(r.value)}</div>
      </div>`
    ).join('');

    document.getElementById('delivery-modal').classList.add('open');
  }

  function closeDeliveryModal() {
    document.getElementById('delivery-modal').classList.remove('open');
  }

  // Close delivery modal on backdrop click or close button
  document.getElementById('delivery-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('delivery-modal')) closeDeliveryModal();
  });
  document.getElementById('delivery-modal-close-btn').addEventListener('click', closeDeliveryModal);

  // Event delegation for order cards (status buttons + delivery info)
  document.getElementById('orders-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'updateStatus') updateStatus(btn.dataset.id, btn.dataset.status);
    if (btn.dataset.action === 'showDelivery') showDeliveryModal(btn.dataset.id);
    if (btn.dataset.action === 'printOrder')   printOrderTicket(btn.dataset.id);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDeliveryModal();
  });

  // Rappel sonore si commande toujours "nouveau" après 5 minutes
  const _reminders = new Map(); // orderId → timeoutId
  function scheduleReminder(orderId) {
    if (_reminders.has(orderId)) return;
    const t = setTimeout(() => {
      _reminders.delete(orderId);
      const o = orders.find(x => x.id === orderId);
      if (o && o.status === 'nouveau') {
        playNotif();
        showToast(`⏰ Rappel — commande non traitée depuis 5 min !`);
        scheduleReminder(orderId); // replanifier tant que non traité
      }
    }, 3 * 60 * 1000);
    _reminders.set(orderId, t);
  }
