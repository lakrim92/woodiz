  // ── Auth ─────────────────────────────────────────────────
  const ADMIN_KEY = 'panuozzo_admin_token';
  let adminPwd = sessionStorage.getItem(ADMIN_KEY) || '';

  function authHeaders() {
    return { 'Content-Type': 'application/json', 'x-admin-password': adminPwd };
  }

  async function doLogin() {
    const pwd = document.getElementById('login-input').value;
    const err = document.getElementById('login-error');
    if (!pwd) { err.textContent = 'Mot de passe requis'; return; }
    try {
      const r = await fetch('/api/auth/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await r.json();
      if (data.ok) {
        adminPwd = data.token;
        sessionStorage.setItem(ADMIN_KEY, data.token);
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        initApp();
      } else {
        err.textContent = 'Mot de passe incorrect';
        document.getElementById('login-input').value = '';
      }
    } catch { err.textContent = 'Erreur réseau'; }
  }

  function doLogout() {
    sessionStorage.removeItem(ADMIN_KEY);
    location.reload();
  }

  document.getElementById('admin-login-btn').addEventListener('click', doLogin);
  document.getElementById('login-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  // Auto-login — vérification du token de session côté serveur
  if (adminPwd) {
    fetch('/api/auth/verify', {
      headers: { 'x-admin-password': adminPwd },
    }).then(r => r.json()).then(d => {
      if (d.ok && d.role === 'admin') {
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        initApp();
      } else {
        sessionStorage.removeItem(ADMIN_KEY);
        adminPwd = '';
      }
    }).catch(() => {});
  }

  // ── Nav ───────────────────────────────────────────────────
  let currentView = 'dashboard';
  const viewTitles = { dashboard: 'Tableau de bord', orders: 'Commandes' };

  function showView(name, btn) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${name}`).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    currentView = name;
    document.getElementById('topbar-title').textContent = viewTitles[name] || name;
    document.getElementById('sidebar').classList.remove('open');
    if (name === 'orders') loadOrders();
  }

  function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
  }

  // ── Topbar date ──────────────────────────────────────────
  function updateClock() {
    const now = new Date();
    document.getElementById('topbar-date').textContent = now.toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }) + ' · ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ── Init ─────────────────────────────────────────────────
  let statsData = null;
  let chartRevenue = null;
  let chartStatus = null;
  let chartPeriod = 7;

  async function initApp() {
    await loadStats();
    loadOrders();
    initSSE();
    startAutoRefresh();
  }

  // ── SSE temps réel ────────────────────────────────────────
  let activeES = null;
  let lastRefresh = null;

  function setSyncStatus(ok) {
    const dot   = document.getElementById('sync-dot');
    const label = document.getElementById('sync-label');
    if (!dot) return;
    dot.style.background = ok ? 'var(--green)' : 'var(--red)';
    if (ok && lastRefresh) {
      const t = lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      label.textContent = `Mis à jour ${t}`;
    } else if (!ok) {
      label.textContent = 'Reconnexion…';
    }
  }

  let sseRetries = 0;
  const SSE_MAX  = 10;

  function initSSE() {
    if (sseRetries >= SSE_MAX) {
      setSyncStatus(false);
      console.warn('SSE : limite de reconnexions atteinte. Rechargez la page.');
      return;
    }
    if (activeES) { activeES.close(); activeES = null; }
    const es = new EventSource(`/api/orders/stream?token=${encodeURIComponent(adminPwd)}`);
    activeES = es;

    es.addEventListener('init', async () => {
      await refresh();
    });

    es.addEventListener('new-order', async () => {
      await refresh();
      showToast('🔔 Nouvelle commande reçue !');
    });

    es.addEventListener('status-update', async () => {
      await refresh();
    });

    es.onopen = () => { setSyncStatus(true); sseRetries = 0; };

    es.onerror = () => {
      setSyncStatus(false);
      if (es.readyState === EventSource.CLOSED) {
        sseRetries++;
        setTimeout(initSSE, 5000);
      }
    };
  }

  // Rafraîchit stats + commandes (sans bloquer l'UI)
  async function refresh() {
    await Promise.all([loadStats(), loadOrders()]);
    // Heure réelle du serveur (pas celle du navigateur)
    lastRefresh = statsData?.serverTime ? new Date(statsData.serverTime) : null;
    setSyncStatus(true);
  }

  // Auto-refresh toutes les 60s (fallback si SSE coupe)
  function startAutoRefresh() {
    setInterval(async () => {
      await refresh();
    }, 60_000);
  }

  // ── Stats ─────────────────────────────────────────────────
  async function loadStats() {
    try {
      const r = await fetch('/api/admin/stats', { headers: authHeaders() });
      statsData = await r.json();
      renderKPIs(statsData);
      renderCharts(statsData);
      renderTopItems(statsData.topItems);
      renderRecentOrders();
    } catch (err) {
      console.error('Stats error:', err);
    }
  }

  function fmt(n) { return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€'; }

  function renderKPIs(s) {
    document.getElementById('kpi-today-rev').textContent    = fmt(s.today.revenue);
    document.getElementById('kpi-today-orders').textContent = s.today.orders + ' commande' + (s.today.orders > 1 ? 's' : '');
    document.getElementById('kpi-month-rev').textContent    = fmt(s.month.revenue);
    document.getElementById('kpi-month-orders').textContent = s.month.orders + ' commande' + (s.month.orders > 1 ? 's' : '');
    document.getElementById('kpi-total-rev').textContent    = fmt(s.total.revenue);
    document.getElementById('kpi-total-orders').textContent = s.total.orders + ' commande' + (s.total.orders > 1 ? 's' : '');
    document.getElementById('kpi-avg').textContent          = fmt(s.avgBasket);
    document.getElementById('kpi-livraison').textContent    = s.byMode.livraison;
    document.getElementById('kpi-emporter').textContent     = s.byMode.emporter + ' à emporter';
    document.getElementById('topbar-sub').textContent       = `${s.total.orders} commandes · CA total ${fmt(s.total.revenue)}`;
    const sbBadge = document.getElementById('sb-badge-orders');
    const active = (s.byStatus.nouveau || 0) + (s.byStatus.en_preparation || 0) + (s.byStatus.pret || 0);
    sbBadge.textContent = active || '';
  }

  function renderCharts(s) {
    const days = s.last30.slice(-chartPeriod);
    const labels = days.map(d => {
      const dt = new Date(d.date);
      return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    });
    const revenues = days.map(d => d.revenue);
    const counts   = days.map(d => d.count);

    if (chartRevenue) chartRevenue.destroy();
    const ctx = document.getElementById('chart-revenue').getContext('2d');
    chartRevenue = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'CA (€)',
            data: revenues,
            backgroundColor: 'rgba(59,130,246,.55)',
            borderColor: 'rgba(59,130,246,.9)',
            borderWidth: 1.5,
            borderRadius: 4,
            yAxisID: 'y',
          },
          {
            label: 'Commandes',
            data: counts,
            type: 'line',
            borderColor: 'rgba(245,158,11,.9)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            tension: .3,
            pointRadius: 3,
            pointBackgroundColor: 'rgba(245,158,11,.9)',
            yAxisID: 'y2',
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: 'rgba(240,244,255,.6)', font: { size: 11 } } } },
        scales: {
          x:  { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: 'rgba(240,244,255,.5)', font: { size: 10 } } },
          y:  { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: 'rgba(240,244,255,.5)', font: { size: 10 }, callback: v => v + '€' } },
          y2: { position: 'right', grid: { display: false }, ticks: { color: 'rgba(245,158,11,.7)', font: { size: 10 } } },
        },
      },
    });

    // Donut statuts
    const statusColors = {
      nouveau:        '#f59e0b',
      en_preparation: '#3b82f6',
      pret:           '#22c55e',
      livre:          'rgba(255,255,255,.2)',
    };
    const statusLabels = { nouveau: 'Nouvelle', en_preparation: 'En prépa', pret: 'Prête', livre: 'Livrée' };
    const statusVals = Object.entries(s.byStatus);

    if (chartStatus) chartStatus.destroy();
    const ctx2 = document.getElementById('chart-status').getContext('2d');
    chartStatus = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: statusVals.map(([k]) => statusLabels[k]),
        datasets: [{
          data: statusVals.map(([, v]) => v),
          backgroundColor: statusVals.map(([k]) => statusColors[k]),
          borderWidth: 0,
          hoverOffset: 4,
        }],
      },
      options: {
        responsive: true,
        cutout: '68%',
        plugins: { legend: { display: false } },
      },
    });

    document.getElementById('donut-legend').innerHTML = statusVals.map(([k, v]) => `
      <div class="donut-legend-item">
        <div class="donut-dot" style="background:${statusColors[k]}"></div>
        <span style="flex:1">${statusLabels[k]}</span>
        <span style="font-weight:700">${v}</span>
      </div>
    `).join('');
  }

  function setChartPeriod(p, btn) {
    chartPeriod = p;
    document.querySelectorAll('.chart-period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (statsData) renderCharts(statsData);
  }

  function renderTopItems(items) {
    if (!items || !items.length) {
      document.getElementById('top-items-list').innerHTML = '<p style="color:var(--muted);font-size:.8rem">Aucune donnée</p>';
      return;
    }
    const max = items[0].qty;
    document.getElementById('top-items-list').innerHTML = items.map(item => `
      <div class="top-item-row">
        <div class="top-item-name" title="${esc(item.name)}">${esc(item.name)}</div>
        <div class="top-item-bar-wrap">
          <div class="top-item-bar" style="width:${Math.round(item.qty / max * 100)}%"></div>
        </div>
        <div class="top-item-count">${item.qty}×</div>
      </div>
    `).join('');
  }

  // ── Commandes ─────────────────────────────────────────────
  let ordersData  = [];
  let currentPage = 1;
  let totalPages  = 1;
  let totalCount  = 0;

  async function loadOrders() {
    const search = document.getElementById('f-search')?.value || '';
    const status = document.getElementById('f-status')?.value || '';
    const mode   = document.getElementById('f-mode')?.value || '';
    const from   = document.getElementById('f-from')?.value || '';
    const to     = document.getElementById('f-to')?.value || '';

    const params = new URLSearchParams({ page: currentPage, limit: 25 });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (mode)   params.set('mode', mode);
    if (from)   params.set('from', from);
    if (to)     params.set('to', to);

    try {
      const r = await fetch(`/api/admin/orders?${params}`, { headers: authHeaders() });
      const data = await r.json();
      ordersData  = data.orders;
      totalPages  = data.pages;
      totalCount  = data.total;
      renderOrdersTable();
      renderPagination();
      renderRecentOrders();
    } catch (err) { console.error('Orders error:', err); }
  }

  const STATUS_LABELS = { nouveau: 'Nouvelle', en_preparation: 'En préparation', pret: 'Prête', livre: 'Livrée' };
  const STATUS_CLASSES = { nouveau: 'pill-nouveau', en_preparation: 'pill-en_preparation', pret: 'pill-pret', livre: 'pill-livre' };

  // Échappement HTML pour prévenir les injections XSS via données clients
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderOrdersTable() {
    const tbody = document.getElementById('orders-tbody');
    if (!ordersData.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:32px">Aucune commande trouvée</td></tr>`;
      return;
    }
    tbody.innerHTML = ordersData.map(o => {
      const d = o.delivery || {};
      const name  = esc(`${d.firstname || d.prenom || ''} ${d.lastname || d.nom || ''}`.trim() || '—');
      const phone = esc(d.phone || d.telephone || '—');
      const email = esc(o.customerEmail || '');
      const isLiv = d.mode === 'livraison';
      const dt = new Date(o.createdAt);
      const dateStr = dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const timeStr = dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const items = esc((o.items || []).map(i => `${i.qty || 1}× ${i.name}`).join(', '));
      return `<tr data-order-id="${esc(o.id)}" style="cursor:pointer">
        <td class="td-number">${String(o.orderNumber).slice(-6)}</td>
        <td><div>${dateStr}</div><div class="td-muted">${timeStr}</div></td>
        <td class="td-name">${name}<div class="td-muted">${email}</div></td>
        <td class="td-muted">${phone}</td>
        <td><span class="mode-badge ${isLiv ? 'mode-livraison' : 'mode-emporter'}">${isLiv ? '🛵 Livraison' : '🏠 Emporter'}</span></td>
        <td class="td-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${items}</td>
        <td class="td-total">${(o.total || 0).toFixed(2)}€${o.promoApplied ? ' <span class="promo-tag">-10%</span>' : ''}</td>
        <td><span class="status-pill ${STATUS_CLASSES[o.status] || ''}">${STATUS_LABELS[o.status] || esc(o.status)}</span></td>
      </tr>`;
    }).join('');
  }

  function renderRecentOrders() {
    const tbody = document.getElementById('recent-tbody');
    if (!tbody) return;
    const recent = ordersData.slice(0, 8);
    if (!recent.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">Aucune commande</td></tr>`;
      return;
    }
    tbody.innerHTML = recent.map(o => {
      const d    = o.delivery || {};
      const name = esc(`${d.firstname || d.prenom || ''} ${d.lastname || d.nom || ''}`.trim() || '—');
      const isLiv = d.mode === 'livraison';
      const time  = new Date(o.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return `<tr data-order-id="${esc(o.id)}" style="cursor:pointer">
        <td class="td-muted">${time}</td>
        <td class="td-name">${name}</td>
        <td><span class="mode-badge ${isLiv ? 'mode-livraison' : 'mode-emporter'}">${isLiv ? '🛵' : '🏠'}</span></td>
        <td class="td-total">${(o.total || 0).toFixed(2)}€${o.promoApplied ? ' <span class="promo-tag">-10%</span>' : ''}</td>
        <td><span class="status-pill ${STATUS_CLASSES[o.status] || ''}">${STATUS_LABELS[o.status] || o.status}</span></td>
      </tr>`;
    }).join('');
  }

  function renderPagination() {
    document.getElementById('pagination-info').textContent =
      `${totalCount} commande${totalCount > 1 ? 's' : ''} · page ${currentPage} / ${totalPages || 1}`;

    const container = document.getElementById('page-btns');
    const btns = [];
    btns.push(`<button class="page-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>`);
    const start = Math.max(1, currentPage - 2);
    const end   = Math.min(totalPages, currentPage + 2);
    if (start > 1) btns.push(`<button class="page-btn" data-page="1">1</button>`);
    if (start > 2) btns.push(`<span style="color:var(--muted);padding:0 4px">…</span>`);
    for (let p = start; p <= end; p++) {
      btns.push(`<button class="page-btn${p === currentPage ? ' active' : ''}" data-page="${p}">${p}</button>`);
    }
    if (end < totalPages - 1) btns.push(`<span style="color:var(--muted);padding:0 4px">…</span>`);
    if (end < totalPages) btns.push(`<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`);
    btns.push(`<button class="page-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>`);
    container.innerHTML = btns.join('');
  }

  function goPage(p) {
    if (p < 1 || p > totalPages) return;
    currentPage = p;
    loadOrders();
  }

  function applyFilters() { currentPage = 1; loadOrders(); }

  function resetFilters() {
    document.getElementById('f-search').value = '';
    document.getElementById('f-status').value = '';
    document.getElementById('f-mode').value = '';
    document.getElementById('f-from').value = '';
    document.getElementById('f-to').value = '';
    applyFilters();
  }

  // ── Modale commande ───────────────────────────────────────
  let modalOrderId = null;

  function openModal(orderId) {
    const order = ordersData.find(o => o.id === orderId);
    if (!order) return;
    modalOrderId = orderId;
    const d = order.delivery || {};
    const name = `${esc(d.firstname || d.prenom || '')} ${esc(d.lastname || d.nom || '')}`.trim() || '—';
    const isLiv = d.mode === 'livraison';
    const dt = new Date(order.createdAt);

    const addrParts = [
      [esc(d.address || d.adresse), esc(d.zip), esc(d.city)].filter(Boolean).join(' '),
      (d.floor || d.etage) && `Ét. ${esc(d.floor || d.etage)}`,
      d.appt && `Apt ${esc(d.appt)}`,
      (d.building || d.batiment) && `Bât. ${esc(d.building || d.batiment)}`,
      (d.code || d.codeAcces) && `Code ${esc(d.code || d.codeAcces)}`,
    ].filter(Boolean).join(', ') || '—';

    const itemsHtml = (order.items || []).map(i => {
      const removedHtml = i.removed?.length ? `<span class="removed">❌ Sans : ${i.removed.map(esc).join(', ')}</span><br>` : '';
      const addedHtml   = i.added?.length   ? `<span class="added">➕ ${i.added.map(a => `${a.qty > 1 ? a.qty + '× ' : ''}${esc(a.name)}`).join(', ')}</span>` : '';
      return `<div class="modal-item-row">
        <div>
          <div class="modal-item-name">${i.qty || 1}× ${esc(i.name)}</div>
          ${(removedHtml || addedHtml) ? `<div class="modal-item-detail">${removedHtml}${addedHtml}</div>` : ''}
          ${i.desc && !i.removed?.length && !i.added?.length ? `<div class="modal-item-detail" style="color:var(--muted)">${esc(i.desc)}</div>` : ''}
        </div>
        <div class="modal-item-price">${typeof i.price === 'number' ? i.price.toFixed(2) + '€' : '—'}</div>
      </div>`;
    }).join('');

    document.getElementById('modal-title').innerHTML =
      `Commande #${String(order.orderNumber).slice(-6)} &nbsp;<span class="status-pill ${STATUS_CLASSES[order.status] || ''}">${STATUS_LABELS[order.status] || order.status}</span>`;

    document.getElementById('modal-body').innerHTML = `
      <!-- Infos client -->
      <div class="modal-section">
        <div class="modal-section-title">👤 Client</div>
        <div class="modal-info-grid">
          <div class="modal-info-item">
            <div class="modal-info-label">Nom</div>
            <div class="modal-info-value">${name}</div>
          </div>
          <div class="modal-info-item">
            <div class="modal-info-label">Téléphone</div>
            <div class="modal-info-value">${esc(d.phone || d.telephone || '—')}</div>
          </div>
          <div class="modal-info-item">
            <div class="modal-info-label">Email</div>
            <div class="modal-info-value" style="font-size:.82rem">${esc(order.customerEmail || '—')}</div>
          </div>
          <div class="modal-info-item">
            <div class="modal-info-label">Date</div>
            <div class="modal-info-value">${dt.toLocaleDateString('fr-FR', {day:'2-digit',month:'long',year:'numeric'})} à ${dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
          </div>
        </div>
      </div>

      <!-- Livraison -->
      <div class="modal-section">
        <div class="modal-section-title">${isLiv ? '🛵 Livraison' : '🏠 Retrait sur place'}</div>
        ${isLiv ? `
          <div class="modal-info-grid">
            <div class="modal-info-item" style="grid-column:1/-1">
              <div class="modal-info-label">Adresse</div>
              <div class="modal-info-value" style="color:var(--blue)">${addrParts}</div>
            </div>
            ${(d.notes || d.instructions) ? `<div class="modal-info-item" style="grid-column:1/-1">
              <div class="modal-info-label">Instructions</div>
              <div class="modal-info-value">${esc(d.notes || d.instructions)}</div>
            </div>` : ''}
          </div>` : '<p style="color:var(--muted);font-size:.85rem">Retrait en pizzeria — 30 Av. Jean Moulin, Bougival</p>'}
      </div>

      <!-- Articles -->
      <div class="modal-section">
        <div class="modal-section-title">🍕 Articles</div>
        ${itemsHtml}
        ${order.promoApplied ? `<div class="modal-promo-row">
          <span>🎉 Réduction première commande (-10%)</span>
          <span>-${(order.discount || 0).toFixed(2)}€</span>
        </div>` : ''}
        <div class="modal-total-row">
          <span>Total payé</span>
          <span style="color:var(--yellow)">${(order.total || 0).toFixed(2)}€</span>
        </div>
      </div>

      <!-- Changer statut -->
      <div class="modal-section">
        <div class="modal-section-title">🔄 Modifier le statut</div>
        <select class="modal-status-select" id="modal-status-select">
          <option value="nouveau"         ${order.status === 'nouveau'         ? 'selected' : ''}>🟡 Nouvelle</option>
          <option value="en_preparation"  ${order.status === 'en_preparation'  ? 'selected' : ''}>🔵 En préparation</option>
          <option value="pret"            ${order.status === 'pret'            ? 'selected' : ''}>🟢 Prête</option>
          <option value="livre"           ${order.status === 'livre'           ? 'selected' : ''}>⚫ Livrée / Récupérée</option>
        </select>
        <button class="btn-update-status" data-action="updateStatus">Mettre à jour le statut</button>
        <button class="btn-delete" data-action="deleteOrder">🗑 Supprimer cette commande</button>
      </div>
    `;

    document.getElementById('order-modal').classList.add('open');
  }

  function closeModal() {
    document.getElementById('order-modal').classList.remove('open');
    modalOrderId = null;
  }

  async function updateStatusFromModal() {
    if (!modalOrderId) return;
    const status = document.getElementById('modal-status-select').value;
    try {
      await fetch(`/api/orders/${modalOrderId}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status }),
      });
      const o = ordersData.find(o => o.id === modalOrderId);
      if (o) o.status = status;
      showToast(`✅ Statut mis à jour : ${STATUS_LABELS[status]}`);
      closeModal();
      renderOrdersTable();
      renderRecentOrders();
      await loadStats();
    } catch { showToast('❌ Erreur', true); }
  }

  async function deleteOrder(id) {
    if (!confirm('Supprimer cette commande définitivement ?')) return;
    try {
      await fetch(`/api/admin/orders/${id}`, { method: 'DELETE', headers: authHeaders() });
      ordersData = ordersData.filter(o => o.id !== id);
      totalCount--;
      showToast('🗑 Commande supprimée');
      closeModal();
      renderOrdersTable();
      renderRecentOrders();
      renderPagination();
      await loadStats();
    } catch { showToast('❌ Erreur', true); }
  }

  // ── Export CSV ────────────────────────────────────────────
  async function exportCSV() {
    const params = new URLSearchParams();
    const search = document.getElementById('f-search')?.value;
    const status = document.getElementById('f-status')?.value;
    const mode   = document.getElementById('f-mode')?.value;
    const from   = document.getElementById('f-from')?.value;
    const to     = document.getElementById('f-to')?.value;
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (mode)   params.set('mode', mode);
    if (from)   params.set('from', from);
    if (to)     params.set('to', to);

    try {
      // Token envoyé dans le header (jamais dans l'URL pour éviter les logs serveur)
      const r = await fetch(`/api/admin/export/csv?${params}`, { headers: authHeaders() });
      if (!r.ok) { showToast('❌ Erreur export', true); return; }
      const blob = await r.blob();
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `panuozzo-commandes-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      showToast('📥 Export CSV téléchargé');
    } catch { showToast('❌ Erreur export', true); }
  }

  // ── Toast ─────────────────────────────────────────────────
  let toastTimer;
  function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.background = isError ? '#ef4444' : '#22c55e';
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  // ── Static event listeners (replacing inline onclick/oninput/onchange) ──
  document.getElementById('nav-dashboard').addEventListener('click', function() { showView('dashboard', this); });
  document.getElementById('nav-orders').addEventListener('click', function() { showView('orders', this); });
  document.getElementById('nav-export').addEventListener('click', exportCSV);
  document.getElementById('nav-logout').addEventListener('click', doLogout);
  document.getElementById('menu-toggle').addEventListener('click', toggleSidebar);
  document.getElementById('topbar-export').addEventListener('click', exportCSV);
  document.getElementById('btn-tout-voir').addEventListener('click', () => showView('orders', document.getElementById('nav-orders')));

  // Chart period delegation
  document.getElementById('chart-period-btns').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (btn) setChartPeriod(parseInt(btn.dataset.period, 10), btn);
  });

  // Filter inputs
  document.getElementById('f-search').addEventListener('input', applyFilters);
  document.getElementById('f-status').addEventListener('change', applyFilters);
  document.getElementById('f-mode').addEventListener('change', applyFilters);
  document.getElementById('f-from').addEventListener('change', applyFilters);
  document.getElementById('f-to').addEventListener('change', applyFilters);
  document.getElementById('filter-reset').addEventListener('click', resetFilters);

  // Order modal
  document.getElementById('order-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('order-modal')) { closeModal(); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'updateStatus') updateStatusFromModal();
    if (btn.dataset.action === 'deleteOrder')  deleteOrder(modalOrderId);
  });
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);

  // Orders table delegation (orders-tbody + recent-tbody)
  document.getElementById('orders-tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-order-id]');
    if (tr) openModal(tr.dataset.orderId);
  });
  document.getElementById('recent-tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-order-id]');
    if (tr) openModal(tr.dataset.orderId);
  });

  // Pagination delegation
  document.getElementById('page-btns').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (btn && !btn.disabled) goPage(parseInt(btn.dataset.page, 10));
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
