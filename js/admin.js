// ── Config restaurants ────────────────────────────────────
const RESTOS = {
  panuozzo: {
    key:      'panuozzo_admin_token',
    name:     'Panuozzo',
    emoji:    '🍕',
    apiBase:  '',                   // same origin (woodiz)
    sseBase:  '/api',
    color:    '#e55a00',
    csvName:  'panuozzo',
    address:  '30 Av. Jean Moulin, Bougival',
    itemIcon: '🍕',
  },
  mythai: {
    key:      'mythai_admin_token',
    name:     'My Thai',
    emoji:    '🌶',
    apiBase:  '/api/proxy/mythai', // proxied via woodiz server
    sseBase:  '/api/proxy/mythai',
    color:    '#C8390B',
    csvName:  'mythai',
    address:  '30 Av. Jean Moulin, Bougival',
    itemIcon: '🥢',
  },
};

let currentResto = 'panuozzo';
function cfg() { return RESTOS[currentResto]; }

// ── Auth ──────────────────────────────────────────────────
const tokens = {
  panuozzo: sessionStorage.getItem(RESTOS.panuozzo.key) || '',
  mythai:   sessionStorage.getItem(RESTOS.mythai.key)   || '',
};

function authHeaders(resto) {
  return { 'Content-Type': 'application/json', 'x-admin-password': tokens[resto] };
}

async function doLogin() {
  const pwd = document.getElementById('login-input').value;
  const err = document.getElementById('login-error');
  if (!pwd) { err.textContent = 'Mot de passe requis'; return; }

  // Authenticate on both servers simultaneously
  try {
    const [rP, rM] = await Promise.all([
      fetch('/api/auth/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      }),
      fetch('/api/proxy/mythai/auth/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      }).catch(() => ({ json: async () => ({ ok: false }) })),
    ]);

    const [dP, dM] = await Promise.all([rP.json(), rM.json()]);

    if (!dP.ok) { err.textContent = 'Mot de passe incorrect'; document.getElementById('login-input').value = ''; return; }

    tokens.panuozzo = dP.token;
    sessionStorage.setItem(RESTOS.panuozzo.key, dP.token);

    if (dM.ok) {
      tokens.mythai = dM.token;
      sessionStorage.setItem(RESTOS.mythai.key, dM.token);
    }

    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    initApp();
  } catch { err.textContent = 'Erreur réseau'; }
}

function doLogout() {
  Object.values(RESTOS).forEach(r => sessionStorage.removeItem(r.key));
  location.reload();
}

document.getElementById('admin-login-btn').addEventListener('click', doLogin);
document.getElementById('login-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// Auto-login si token panuozzo valide
const savedToken = sessionStorage.getItem(RESTOS.panuozzo.key);
if (savedToken) {
  fetch('/api/auth/verify', { headers: { 'x-admin-password': savedToken } })
    .then(r => r.json()).then(d => {
      if (d.ok && d.role === 'admin') {
        tokens.panuozzo = savedToken;
        const mt = sessionStorage.getItem(RESTOS.mythai.key);
        if (mt) tokens.mythai = mt;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        initApp();
      } else {
        Object.values(RESTOS).forEach(r => sessionStorage.removeItem(r.key));
      }
    }).catch(() => {});
}

// ── Restaurant switcher ───────────────────────────────────
document.getElementById('resto-switcher').addEventListener('click', e => {
  const btn = e.target.closest('[data-resto]');
  if (!btn) return;
  const r = btn.dataset.resto;
  if (r === currentResto) return;
  currentResto = r;
  document.querySelectorAll('.resto-btn').forEach(b => b.classList.toggle('active', b.dataset.resto === r));
  updateBranding();
  resetState();
  initApp();
});

function updateBranding() {
  const r = cfg();
  document.getElementById('sidebar-logo-name').textContent = r.name;
  document.getElementById('sidebar-logo-emoji').textContent = r.emoji;
  document.title = `Admin — ${r.name}`;
}

// ── Nav ───────────────────────────────────────────────────
let currentView = 'dashboard';
const viewTitles = { dashboard: 'Tableau de bord', orders: 'Commandes', google: 'Google & SEO' };

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

// ── Clock ─────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('topbar-date').textContent =
    now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
    ' · ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ── State ─────────────────────────────────────────────────
let statsData   = null;
let chartRevenue = null;
let chartStatus  = null;
let chartPeriod  = 7;
let ordersData   = [];
let currentPage  = 1;
let totalPages   = 1;
let totalCount   = 0;

function resetState() {
  statsData = null; ordersData = []; currentPage = 1; totalPages = 1; totalCount = 0;
  if (chartRevenue) { chartRevenue.destroy(); chartRevenue = null; }
  if (chartStatus)  { chartStatus.destroy();  chartStatus  = null; }
  document.getElementById('kpi-today-rev').textContent    = '—';
  document.getElementById('kpi-month-rev').textContent    = '—';
  document.getElementById('kpi-total-rev').textContent    = '—';
  document.getElementById('kpi-avg').textContent          = '—';
  document.getElementById('kpi-livraison').textContent    = '—';
  document.getElementById('orders-tbody').innerHTML       = '';
  document.getElementById('recent-tbody').innerHTML       = '';
  document.getElementById('top-items-list').innerHTML     = '';
}

// ── API helpers ───────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const r = cfg();
  const url = `${r.apiBase}${path}`;
  return fetch(url, { ...options, headers: { ...authHeaders(currentResto), ...(options.headers || {}) } });
}

// ── Init ──────────────────────────────────────────────────
async function initApp() {
  updateBranding();
  await loadStats();
  loadOrders();
  initSSE();
  startAutoRefresh();
}

// ── SSE ───────────────────────────────────────────────────
let activeES = null;
let lastRefresh = null;
let sseRetries = 0;
const SSE_MAX  = 10;

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

function initSSE() {
  if (sseRetries >= SSE_MAX) { setSyncStatus(false); return; }
  if (activeES) { activeES.close(); activeES = null; }
  const r = cfg();
  const sseUrl = `${r.sseBase}/orders/stream?token=${encodeURIComponent(tokens[currentResto])}`;
  const es = new EventSource(sseUrl);
  activeES = es;
  es.addEventListener('init',          async () => { await refresh(); });
  es.addEventListener('new-order',     async () => { await refresh(); showToast('🔔 Nouvelle commande !'); });
  es.addEventListener('status-update', async () => { await refresh(); });
  es.onopen  = () => { setSyncStatus(true); sseRetries = 0; };
  es.onerror = () => {
    setSyncStatus(false);
    if (es.readyState === EventSource.CLOSED) { sseRetries++; setTimeout(initSSE, 5000); }
  };
}

async function refresh() {
  await Promise.all([loadStats(), loadOrders()]);
  lastRefresh = statsData?.serverTime ? new Date(statsData.serverTime) : new Date();
  setSyncStatus(true);
}

function startAutoRefresh() {
  setInterval(() => refresh(), 60_000);
}

// ── Stats ─────────────────────────────────────────────────
async function loadStats() {
  try {
    const r   = await apiFetch('/api/admin/stats');
    statsData = await r.json();
    renderKPIs(statsData);
    renderCharts(statsData);
    renderTopItems(statsData.topItems);
    renderRecentOrders();
  } catch (err) { console.error('Stats error:', err); }
}

function fmt(n) {
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€';
}

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
  document.getElementById('topbar-sub').textContent       = `${cfg().emoji} ${cfg().name} · ${s.total.orders} commandes · CA total ${fmt(s.total.revenue)}`;
  const sbBadge = document.getElementById('sb-badge-orders');
  const active  = (s.byStatus.nouveau || 0) + (s.byStatus.en_preparation || 0) + (s.byStatus.pret || 0);
  sbBadge.textContent = active || '';
}

function renderCharts(s) {
  const days     = s.last30.slice(-chartPeriod);
  const labels   = days.map(d => new Date(d.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
  const revenues = days.map(d => d.revenue);
  const counts   = days.map(d => d.count);
  const accent   = cfg().color;

  if (chartRevenue) chartRevenue.destroy();
  chartRevenue = new Chart(document.getElementById('chart-revenue').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'CA (€)', data: revenues,
          backgroundColor: accent + '8c', borderColor: accent, borderWidth: 1.5, borderRadius: 4, yAxisID: 'y' },
        { label: 'Commandes', data: counts, type: 'line',
          borderColor: 'rgba(245,158,11,.9)', backgroundColor: 'transparent',
          borderWidth: 2, tension: .3, pointRadius: 3, pointBackgroundColor: 'rgba(245,158,11,.9)', yAxisID: 'y2' },
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

  const statusColors = {
    nouveau: '#f59e0b', en_preparation: '#3b82f6', pret: '#22c55e', livre: 'rgba(255,255,255,.2)',
  };
  const statusLabels = { nouveau: 'Nouvelle', en_preparation: 'En prépa', pret: 'Prête', livre: 'Livrée' };
  const statusVals = Object.entries(s.byStatus);

  if (chartStatus) chartStatus.destroy();
  chartStatus = new Chart(document.getElementById('chart-status').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: statusVals.map(([k]) => statusLabels[k]),
      datasets: [{ data: statusVals.map(([, v]) => v),
        backgroundColor: statusVals.map(([k]) => statusColors[k]), borderWidth: 0, hoverOffset: 4 }],
    },
    options: { responsive: true, cutout: '68%', plugins: { legend: { display: false } } },
  });

  document.getElementById('donut-legend').innerHTML = statusVals.map(([k, v]) => `
    <div class="donut-legend-item">
      <div class="donut-dot" style="background:${statusColors[k]}"></div>
      <span style="flex:1">${statusLabels[k]}</span>
      <span style="font-weight:700">${v}</span>
    </div>`).join('');
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
        <div class="top-item-bar" style="width:${Math.round(item.qty / max * 100)}%;background:${cfg().color}"></div>
      </div>
      <div class="top-item-count">${item.qty}×</div>
    </div>`).join('');
}

// ── Commandes ─────────────────────────────────────────────
async function loadOrders() {
  const search = document.getElementById('f-search')?.value || '';
  const status = document.getElementById('f-status')?.value || '';
  const mode   = document.getElementById('f-mode')?.value   || '';
  const from   = document.getElementById('f-from')?.value   || '';
  const to     = document.getElementById('f-to')?.value     || '';
  const params = new URLSearchParams({ page: currentPage, limit: 25 });
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (mode)   params.set('mode',   mode);
  if (from)   params.set('from',   from);
  if (to)     params.set('to',     to);
  try {
    const r    = await apiFetch(`/api/admin/orders?${params}`);
    const data = await r.json();
    ordersData  = data.orders;
    totalPages  = data.pages;
    totalCount  = data.total;
    renderOrdersTable();
    renderPagination();
    renderRecentOrders();
  } catch (err) { console.error('Orders error:', err); }
}

const STATUS_LABELS  = { nouveau: 'Nouvelle', en_preparation: 'En préparation', pret: 'Prête', livre: 'Livrée' };
const STATUS_CLASSES = { nouveau: 'pill-nouveau', en_preparation: 'pill-en_preparation', pret: 'pill-pret', livre: 'pill-livre' };

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderOrdersTable() {
  const tbody = document.getElementById('orders-tbody');
  if (!ordersData.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:32px">Aucune commande trouvée</td></tr>`;
    return;
  }
  tbody.innerHTML = ordersData.map(o => {
    const d     = o.delivery || {};
    const name  = esc(`${d.firstname || d.prenom || ''} ${d.lastname || d.nom || ''}`.trim() || '—');
    const phone = esc(d.phone || d.telephone || '—');
    const email = esc(o.customerEmail || '');
    const isLiv = d.mode === 'livraison';
    const dt    = new Date(o.createdAt);
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
  ['f-search','f-status','f-mode','f-from','f-to'].forEach(id => {
    document.getElementById(id).value = '';
  });
  applyFilters();
}

// ── Modale commande ───────────────────────────────────────
let modalOrderId = null;

function openModal(orderId) {
  const order = ordersData.find(o => o.id === orderId);
  if (!order) return;
  modalOrderId = orderId;
  const d    = order.delivery || {};
  const name = `${esc(d.firstname || d.prenom || '')} ${esc(d.lastname || d.nom || '')}`.trim() || '—';
  const isLiv = d.mode === 'livraison';
  const dt   = new Date(order.createdAt);
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

  // Restaurant badge in modal title
  const restoBadge = `<span style="font-size:.7rem;padding:2px 8px;border-radius:4px;background:${cfg().color}22;color:${cfg().color};border:1px solid ${cfg().color}44;margin-left:8px">${cfg().emoji} ${cfg().name}</span>`;

  document.getElementById('modal-title').innerHTML =
    `Commande #${String(order.orderNumber).slice(-6)}${restoBadge} &nbsp;<span class="status-pill ${STATUS_CLASSES[order.status] || ''}">${STATUS_LABELS[order.status] || order.status}</span>`;

  document.getElementById('modal-body').innerHTML = `
    <div class="modal-section">
      <div class="modal-section-title">👤 Client</div>
      <div class="modal-info-grid">
        <div class="modal-info-item"><div class="modal-info-label">Nom</div><div class="modal-info-value">${name}</div></div>
        <div class="modal-info-item"><div class="modal-info-label">Téléphone</div><div class="modal-info-value">${esc(d.phone || d.telephone || '—')}</div></div>
        <div class="modal-info-item"><div class="modal-info-label">Email</div><div class="modal-info-value" style="font-size:.82rem">${esc(order.customerEmail || '—')}</div></div>
        <div class="modal-info-item"><div class="modal-info-label">Date</div><div class="modal-info-value">${dt.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})} à ${dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div></div>
      </div>
    </div>
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
        </div>` : `<p style="color:var(--muted);font-size:.85rem">Retrait en cuisine — ${cfg().address}</p>`}
    </div>
    <div class="modal-section">
      <div class="modal-section-title">${cfg().itemIcon} Articles</div>
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
    <div class="modal-section">
      <div class="modal-section-title">🔄 Modifier le statut</div>
      <select class="modal-status-select" id="modal-status-select">
        <option value="nouveau"        ${order.status === 'nouveau'        ? 'selected' : ''}>🟡 Nouvelle</option>
        <option value="en_preparation" ${order.status === 'en_preparation' ? 'selected' : ''}>🔵 En préparation</option>
        <option value="pret"           ${order.status === 'pret'           ? 'selected' : ''}>🟢 Prête</option>
        <option value="livre"          ${order.status === 'livre'          ? 'selected' : ''}>⚫ Livrée / Récupérée</option>
      </select>
      <button class="btn-update-status" data-action="updateStatus">Mettre à jour le statut</button>
      <button class="btn-delete" data-action="deleteOrder">🗑 Supprimer cette commande</button>
    </div>`;

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
    await apiFetch(`/api/orders/${modalOrderId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
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
    await apiFetch(`/api/admin/orders/${id}`, { method: 'DELETE' });
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

// ── Google & SEO ─────────────────────────────────────────
let chartGoogle = null;
let googleData  = null;

async function googleFetch(path, options = {}) {
  return fetch(path, { ...options, headers: { 'x-admin-password': tokens.panuozzo, ...(options.headers || {}) } });
}

async function loadGoogleData() {
  try {
    const r = await googleFetch('/api/admin/google');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    googleData = await r.json();
    renderGoogleKPIs(googleData);
    renderGoogleChart(googleData);
    renderGoogleTopQueries(googleData);
    renderGoogleMyBusiness(googleData);
    renderCoreWebVitals(googleData);
    renderSEOChecklist(googleData);
    const sync = googleData.pagespeed?.fetchedAt || googleData.lastUpdated;
    const syncEl = document.getElementById('google-last-sync');
    if (sync) {
      const d = new Date(sync);
      syncEl.textContent = 'PageSpeed : ' + d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else {
      syncEl.textContent = 'PageSpeed : cliquez sur Actualiser pour lancer l\'analyse';
    }
  } catch (err) { console.error('Google stats error:', err); }
}

function renderGoogleKPIs(d) {
  const sc = d.searchConsole || {};
  const ps = d.pagespeed;
  const hasGSC = sc.impressions !== null && sc.impressions !== undefined;

  document.getElementById('gkpi-impressions').textContent = hasGSC ? Number(sc.impressions).toLocaleString('fr-FR') : '—';
  document.getElementById('gkpi-clicks').textContent      = hasGSC ? Number(sc.clicks).toLocaleString('fr-FR') : '—';
  document.getElementById('gkpi-ctr').textContent         = hasGSC ? (sc.ctr || 0).toFixed(1) + '%' : '—';
  document.getElementById('gkpi-position').textContent    = hasGSC ? '#' + Math.round(sc.position || 0) : '—';

  const scoreEl    = document.getElementById('gkpi-score');
  const scoreSubEl = document.getElementById('gkpi-score-sub');
  if (ps?.score !== undefined && ps.score !== null) {
    const score = ps.score;
    scoreEl.textContent = score;
    scoreEl.style.color = score >= 90 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
    scoreSubEl.textContent = 'PageSpeed mobile';
  } else {
    scoreEl.textContent = '—';
    scoreEl.style.color = '';
    scoreSubEl.textContent = 'PageSpeed (chargement…)';
  }
}

function renderGoogleChart(d) {
  const history = (d.searchConsole || {}).history || [];
  const canvas  = document.getElementById('chart-google');
  const empty   = document.getElementById('gsc-chart-empty');

  if (!history.length) {
    canvas.style.display = 'none';
    empty.style.display  = 'flex';
    return;
  }
  canvas.style.display = 'block';
  empty.style.display  = 'none';

  const labels      = history.map(h => new Date(h.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
  const impressions = history.map(h => h.impressions);
  const clicks      = history.map(h => h.clicks);

  if (chartGoogle) chartGoogle.destroy();
  chartGoogle = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Impressions', data: impressions, borderColor: 'rgba(66,133,244,.9)',
          backgroundColor: 'rgba(66,133,244,.08)', fill: true, borderWidth: 2,
          tension: .3, pointRadius: 2, yAxisID: 'y' },
        { label: 'Clics', data: clicks, borderColor: 'rgba(52,168,83,.9)',
          backgroundColor: 'transparent', borderWidth: 2,
          tension: .3, pointRadius: 2, yAxisID: 'y2' },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: 'rgba(240,244,255,.6)', font: { size: 11 } } } },
      scales: {
        x:  { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: 'rgba(240,244,255,.5)', font: { size: 10 } } },
        y:  { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: 'rgba(66,133,244,.7)', font: { size: 10 } } },
        y2: { position: 'right', grid: { display: false }, ticks: { color: 'rgba(52,168,83,.7)', font: { size: 10 } } },
      },
    },
  });
}

function renderGoogleTopQueries(d) {
  const queries = (d.searchConsole || {}).topQueries || [];
  const el = document.getElementById('google-top-queries');
  if (!queries.length) {
    el.innerHTML = `<div class="gsc-empty"><span style="font-size:2rem">🔍</span><p>Aucune requête disponible</p></div>`;
    return;
  }
  const max = queries[0]?.clicks || 1;
  el.innerHTML = queries.map(q => `
    <div class="top-item-row" style="margin-bottom:8px">
      <div class="top-item-name" title="${esc(q.query)}">${esc(q.query)}</div>
      <div class="top-item-bar-wrap">
        <div class="top-item-bar" style="width:${Math.round((q.clicks || 0) / max * 100)}%;background:#4285F4"></div>
      </div>
      <div class="top-item-count" style="width:50px;text-align:right;color:var(--muted);font-size:.75rem">
        ${q.clicks}c / #${Math.round(q.position || 0)}
      </div>
    </div>`).join('');
}

function renderGoogleMyBusiness(d) {
  const gmb = d.myBusiness || {};
  const num = v => (v !== null && v !== undefined) ? Number(v).toLocaleString('fr-FR') : '—';

  document.getElementById('gmb-rating').textContent       = gmb.rating || '4.8';
  document.getElementById('gmb-review-count').textContent = (gmb.reviewCount || '124') + ' avis Google';
  document.getElementById('gmb-views').textContent        = num(gmb.views);
  document.getElementById('gmb-searches').textContent     = num(gmb.searches);
  document.getElementById('gmb-calls').textContent        = num(gmb.calls);
  document.getElementById('gmb-directions').textContent   = num(gmb.directions);

  const rating = parseFloat(gmb.rating) || 4.8;
  const full   = Math.floor(rating);
  const half   = rating % 1 >= 0.5 ? 1 : 0;
  document.getElementById('gmb-stars').textContent = '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - half);

  const updatedEl = document.getElementById('gmb-updated-label');
  if (updatedEl && gmb.updatedAt) {
    updatedEl.textContent = 'Mis à jour le ' + new Date(gmb.updatedAt).toLocaleDateString('fr-FR');
  }
}

function openGmbForm() {
  const gmb = (googleData || {}).myBusiness || {};
  document.getElementById('gmb-input-views').value      = gmb.views      ?? '';
  document.getElementById('gmb-input-searches').value   = gmb.searches   ?? '';
  document.getElementById('gmb-input-calls').value      = gmb.calls      ?? '';
  document.getElementById('gmb-input-directions').value = gmb.directions ?? '';
  document.getElementById('gmb-input-rating').value     = gmb.rating     ?? '';
  document.getElementById('gmb-input-reviews').value    = gmb.reviewCount ?? '';
  document.getElementById('gmb-stats-view').style.display = 'none';
  document.getElementById('gmb-stats-form').style.display = 'block';
}

function closeGmbForm() {
  document.getElementById('gmb-stats-view').style.display = 'block';
  document.getElementById('gmb-stats-form').style.display = 'none';
}

async function saveGmbStats() {
  const parse = id => { const v = document.getElementById(id).value; return v !== '' ? Number(v) : null; };
  const myBusiness = {
    views:       parse('gmb-input-views'),
    searches:    parse('gmb-input-searches'),
    calls:       parse('gmb-input-calls'),
    directions:  parse('gmb-input-directions'),
    rating:      parse('gmb-input-rating'),
    reviewCount: parse('gmb-input-reviews'),
    updatedAt:   new Date().toISOString(),
  };
  try {
    const r = await googleFetch('/api/admin/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ myBusiness }),
    });
    const d = await r.json();
    if (d.ok) {
      if (googleData) googleData.myBusiness = d.data.myBusiness;
      renderGoogleMyBusiness(googleData || { myBusiness });
      closeGmbForm();
      showToast('✅ Google Business mis à jour !');
    }
  } catch { showToast('❌ Erreur sauvegarde', true); }
}

function renderCoreWebVitals(d) {
  const ps = d.pagespeed;
  if (!ps || ps.score === undefined || ps.score === null) return;

  const score = ps.score;
  const arc   = document.getElementById('ps-arc');
  const circumference = 2 * Math.PI * 38;
  const offset = circumference * (1 - score / 100);
  arc.style.strokeDasharray  = circumference;
  arc.style.strokeDashoffset = offset;
  arc.style.stroke = score >= 90 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';

  const valEl   = document.getElementById('ps-score-val');
  const labelEl = document.getElementById('ps-score-label');
  valEl.textContent   = score;
  valEl.style.color   = score >= 90 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
  labelEl.textContent = score >= 90 ? '✅ Excellent' : score >= 50 ? '⚠️ À améliorer' : '❌ Faible';

  // Date sync
  const dateEl = document.getElementById('cwv-date');
  if (ps.fetchedAt) {
    dateEl.textContent = new Date(ps.fetchedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  }

  // Metrics: LCP (good ≤2.5s, warn ≤4s)
  setCWVBar('lcp', ps.lcp, ps.lcpNum, 8000, ms => ms <= 2500 ? 'good' : ms <= 4000 ? 'warn' : 'bad');
  // FCP (good ≤1.8s, warn ≤3s)
  setCWVBar('fcp', ps.fcp, ps.fcpNum, 6000, ms => ms <= 1800 ? 'good' : ms <= 3000 ? 'warn' : 'bad');
  // CLS (good ≤0.1, warn ≤0.25)
  setCWVBar('cls', ps.cls, ps.clsNum ?? 0, 0.5, v => v <= 0.1 ? 'good' : v <= 0.25 ? 'warn' : 'bad');
  // TBT (good ≤200ms, warn ≤600ms)
  setCWVBar('tbt', ps.tbt, ps.tbtNum ?? 0, 1200, ms => ms <= 200 ? 'good' : ms <= 600 ? 'warn' : 'bad');
  // SI (good ≤3.4s, warn ≤5.8s) — parse displayValue "2.7 s" → 2700ms
  const siMs = ps.siNum ?? (ps.si ? parseFloat(ps.si) * 1000 : null);
  setCWVBar('si', ps.si, siMs, 10000, ms => ms <= 3400 ? 'good' : ms <= 5800 ? 'warn' : 'bad');
}

function setCWVBar(metric, display, numericMs, maxMs, gradeFn) {
  const bar = document.getElementById(`cwv-bar-${metric}`);
  const val = document.getElementById(`cwv-val-${metric}`);
  if (!bar || !val) return;
  val.textContent = (display !== null && display !== undefined && display !== '') ? display : '—';
  if (numericMs === null || numericMs === undefined || !maxMs || !gradeFn) return;
  const grade = gradeFn(numericMs);
  // Minimum 4% width so the bar is always visible when a value exists
  const pct = Math.max(4, Math.min(100, Math.round((numericMs / maxMs) * 100)));
  bar.style.width = pct + '%';
  bar.className = `cwv-bar cwv-${grade}`;
}

function renderSEOChecklist(d) {
  const items = d.seoChecklist || [];
  const el    = document.getElementById('seo-checklist');
  const done  = items.filter(i => i.done).length;
  document.getElementById('seo-score-badge').textContent = `${done}/${items.length}`;
  el.innerHTML = items.map(item => `
    <div class="checklist-item">
      <span class="${item.done ? 'check-done' : 'check-todo'}">${item.done ? '✅' : '⬜'}</span>
      <span style="${item.done ? '' : 'color:var(--muted)'}">${esc(item.label)}</span>
    </div>`).join('');
}

async function refreshPageSpeed() {
  const btn = document.getElementById('btn-google-refresh');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = '⏳ Synchronisation…';
  try {
    const r = await googleFetch('/api/admin/google/sync', { method: 'POST' });
    const d = await r.json();
    if (!r.ok || !d.ok) { showToast('❌ Erreur sync Google', true); return; }
    googleData = d.data;
    renderGoogleKPIs(googleData);
    renderGoogleChart(googleData);
    renderGoogleTopQueries(googleData);
    renderGoogleMyBusiness(googleData);
    renderCoreWebVitals(googleData);
    renderSEOChecklist(googleData);
    document.getElementById('google-last-sync').textContent =
      'Sync : ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (d.errors?.searchConsole) {
      showToast('⚠️ GSC : ' + d.errors.searchConsole, true);
    } else {
      showToast('✅ Google synchronisé !');
    }
  } catch { showToast('❌ Erreur réseau', true); }
  finally {
    btn.disabled = false;
    btn.textContent = '🔄 Synchroniser';
  }
}

// ── Export CSV ────────────────────────────────────────────
async function exportCSV() {
  const params = new URLSearchParams();
  ['f-search','f-status','f-mode','f-from','f-to'].forEach(id => {
    const v = document.getElementById(id)?.value;
    const key = id.replace('f-', '');
    if (v) params.set(key === 'search' ? 'search' : key, v);
  });
  try {
    const r = await apiFetch(`/api/admin/export/csv?${params}`);
    if (!r.ok) { showToast('❌ Erreur export', true); return; }
    const blob = await r.blob();
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${cfg().csvName}-commandes-${date}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
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

// ── Event listeners ───────────────────────────────────────
document.getElementById('nav-dashboard').addEventListener('click', function() { showView('dashboard', this); });
document.getElementById('nav-orders').addEventListener('click', function() { showView('orders', this); });
document.getElementById('nav-google').addEventListener('click', function() {
  showView('google', this);
  loadGoogleData();
});
document.getElementById('btn-google-refresh')?.addEventListener('click', refreshPageSpeed);
document.getElementById('btn-gmb-edit')?.addEventListener('click', openGmbForm);
document.getElementById('btn-gmb-cancel')?.addEventListener('click', closeGmbForm);
document.getElementById('btn-gmb-save')?.addEventListener('click', saveGmbStats);
document.getElementById('nav-export').addEventListener('click', exportCSV);
document.getElementById('nav-logout').addEventListener('click', doLogout);
document.getElementById('menu-toggle').addEventListener('click', toggleSidebar);
document.getElementById('topbar-export').addEventListener('click', exportCSV);
document.getElementById('btn-tout-voir').addEventListener('click', () => showView('orders', document.getElementById('nav-orders')));

document.getElementById('chart-period-btns').addEventListener('click', e => {
  const btn = e.target.closest('[data-period]');
  if (btn) setChartPeriod(parseInt(btn.dataset.period, 10), btn);
});

document.getElementById('f-search').addEventListener('input',  applyFilters);
document.getElementById('f-status').addEventListener('change', applyFilters);
document.getElementById('f-mode').addEventListener('change',   applyFilters);
document.getElementById('f-from').addEventListener('change',   applyFilters);
document.getElementById('f-to').addEventListener('change',     applyFilters);
document.getElementById('filter-reset').addEventListener('click', resetFilters);

document.getElementById('order-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('order-modal')) { closeModal(); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'updateStatus') updateStatusFromModal();
  if (btn.dataset.action === 'deleteOrder')  deleteOrder(modalOrderId);
});
document.getElementById('modal-close-btn').addEventListener('click', closeModal);

document.getElementById('orders-tbody').addEventListener('click', e => {
  const tr = e.target.closest('[data-order-id]');
  if (tr) openModal(tr.dataset.orderId);
});
document.getElementById('recent-tbody').addEventListener('click', e => {
  const tr = e.target.closest('[data-order-id]');
  if (tr) openModal(tr.dataset.orderId);
});

document.getElementById('page-btns').addEventListener('click', e => {
  const btn = e.target.closest('[data-page]');
  if (btn && !btn.disabled) goPage(parseInt(btn.dataset.page, 10));
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});
