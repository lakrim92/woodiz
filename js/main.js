/* =========================================
   PANUOZZO – main.js
   ========================================= */

// ── Burger menu ──────────────────────────────────────────
const burger    = document.getElementById('burger');
const mobileNav = document.getElementById('mobile-nav');

burger.addEventListener('click', () => {
  mobileNav.classList.toggle('open');
});

function closeNav() {
  mobileNav.classList.remove('open');
}

// Close nav when a link inside mobile-nav is clicked
mobileNav.addEventListener('click', (e) => {
  if (e.target.tagName === 'A') closeNav();
});

// Close nav when clicking outside
document.addEventListener('click', (e) => {
  if (!burger.contains(e.target) && !mobileNav.contains(e.target)) {
    mobileNav.classList.remove('open');
  }
});

// ── Statut ouvert/fermé ──────────────────────────────────
let restaurantOpen = false; // état global utilisé par le checkout

function updateStatut() {
  const el      = document.getElementById('statut-ouvert');
  const heroEl  = document.getElementById('hero-statut');

  const now = new Date();
  const day = now.getDay();  // 0 = dim, 1 = lun, ..., 6 = sam
  const h   = now.getHours();
  const m   = now.getMinutes();
  const hm  = h * 60 + m;  // minutes depuis minuit

  // Horaires : Mar–Dim 11h00-15h00 & 18h00-23h00 / Lundi fermé
  const midi_open  = 11 * 60;
  const midi_close = 15 * 60;
  const soir_open  = 18 * 60;
  const soir_close = 23 * 60;

  let isOpen   = false;
  let closesAt = '';

  // Lundi (day=1) : fermé toute la journée
  // Mar–Sam (2–6) et Dim (0) : mêmes horaires midi + soir
  if (day !== 1) {
    if (hm >= midi_open && hm < midi_close) { isOpen = true; closesAt = '15h00'; }
    else if (hm >= soir_open && hm < soir_close) { isOpen = true; closesAt = '23h00'; }
  }

  let next = '';
  if (!isOpen) {
    if (day === 1) next = 'Ouvre demain à 11h00';
    else if (day === 0 && hm >= soir_close) next = 'Ouvre mardi à 11h00';
    else if (day === 6 && hm >= soir_close) next = 'Ouvre dimanche à 11h00';
    else if (hm < midi_open) next = 'Ouvre à 11h00';
    else if (hm >= midi_close && hm < soir_open) next = 'Ouvre à 18h00';
    else next = 'Ouvre demain à 11h00';
  }

  restaurantOpen = isOpen;

  // Bandeau horaires (texte sobre)
  if (el) {
    el.innerHTML = isOpen
      ? `<span style="color:#4ade80;font-weight:700;">● Ouvert jusqu'à ${closesAt}</span>`
      : `<span style="color:#fbbf24;font-weight:700;">● Fermé — ${next}</span>`;
  }

  // Badge hero (pill visuelle)
  if (heroEl) {
    heroEl.style.display = '';
    if (isOpen) {
      heroEl.style.background  = 'rgba(74, 222, 128, .15)';
      heroEl.style.color       = '#4ade80';
      heroEl.style.borderColor = 'rgba(74, 222, 128, .4)';
      heroEl.style.fontWeight  = '700';
      heroEl.textContent       = `🟢 Ouvert jusqu'à ${closesAt}`;
    } else {
      heroEl.style.background  = 'rgba(251, 191, 36, .12)';
      heroEl.style.color       = '#fbbf24';
      heroEl.style.borderColor = 'rgba(251, 191, 36, .35)';
      heroEl.style.fontWeight  = '700';
      heroEl.textContent       = `🔴 Fermé — ${next}`;
    }
  }

  // Blocage du panier si fermé
  const notice    = document.getElementById('cart-closed-notice');
  const btns      = document.getElementById('cart-delivery-btns');
  const label     = document.querySelector('.cart-delivery-label');
  const nextEl    = document.getElementById('cart-next-open');
  const banner    = document.getElementById('restaurant-closed-banner');
  const bannerNext = document.getElementById('rcb-next');

  if (nextEl)     nextEl.textContent    = next;
  if (bannerNext) bannerNext.textContent = next;
  if (notice) notice.style.display = isOpen ? 'none'  : 'flex';
  if (btns)   btns.style.display   = isOpen ? 'grid'  : 'none';
  if (label)  label.style.display  = isOpen ? ''      : 'none';
  if (banner) banner.style.display = isOpen ? 'none'  : 'flex';
}

updateStatut();
setInterval(updateStatut, 30_000);

// ── Onglets menu ─────────────────────────────────────────
const tabs        = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

function animateCards(container) {
  container.querySelectorAll('.pizza-card, .hd-card, .formule-card, .drink-card').forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(18px)';
    el.style.transition = 'opacity .35s ease, transform .35s ease';
    setTimeout(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, i * 45);
  });
}

function switchToTab(target) {
  const tab = document.querySelector(`.tab[data-tab="${target}"]`);
  if (!tab) return;
  tabs.forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  const searchEl = document.getElementById('pizza-search');
  if (searchEl) searchEl.value = '';
  tabContents.forEach(content => {
    if (content.id === `tab-${target}`) {
      content.classList.remove('hidden');
      animateCards(content);
    } else {
      content.classList.add('hidden');
    }
  });
  document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function switchToTabAndScroll(target, cardId) {
  switchToTab(target);
  // Wait for tab to be visible before scrolling to the card
  setTimeout(() => {
    const card = document.getElementById(cardId);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 350);
}

// Wire hero banners (offre exclusive + menu midi)
document.getElementById('btn-offre-exclusive')?.addEventListener('click', () => switchToTabAndScroll('formules', 'formule-card-exclusive'));
document.getElementById('btn-offre-exclusive')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchToTabAndScroll('formules', 'formule-card-exclusive'); } });
document.getElementById('btn-menu-midi')?.addEventListener('click', () => switchToTabAndScroll('formules', 'formule-card-midi'));
document.getElementById('btn-menu-midi')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchToTabAndScroll('formules', 'formule-card-midi'); } });

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Auto-scroll active tab into view on mobile
    tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

    // Reset search when switching tabs
    const searchEl = document.getElementById('pizza-search');
    if (searchEl) searchEl.value = '';

    tabContents.forEach(content => {
      if (content.id === `tab-${target}`) {
        content.classList.remove('hidden');
        animateCards(content);
      } else {
        content.classList.add('hidden');
      }
    });
  });
});


// ── Recherche pizza ───────────────────────────────────────
document.getElementById('pizza-search').addEventListener('input', (e) => {
  const query      = e.target.value.trim();
  const searchTab  = document.getElementById('tab-search');
  const resultsGrid = document.getElementById('search-results-grid');
  const label       = document.getElementById('search-label');
  const noResults   = document.getElementById('no-results');

  if (!query) {
    // Quitte le mode recherche — ré-affiche l'onglet actif
    searchTab.classList.add('hidden');
    const activeBtn = document.querySelector('.tab.active');
    if (activeBtn) {
      const activeContent = document.getElementById(`tab-${activeBtn.dataset.tab}`);
      if (activeContent) activeContent.classList.remove('hidden');
    }
    return;
  }

  // Cache tous les onglets et affiche les résultats
  tabContents.forEach(c => c.classList.add('hidden'));
  searchTab.classList.remove('hidden');

  const q = query.toLowerCase();
  const matches = [];
  document.querySelectorAll('#tab-tomate .pizza-card, #tab-creme .pizza-card').forEach(card => {
    const text = (card.querySelector('h3')?.textContent || '') + ' ' + (card.querySelector('p')?.textContent || '');
    if (text.toLowerCase().includes(q)) {
      matches.push(card.cloneNode(true));
    }
  });

  if (matches.length === 0) {
    resultsGrid.innerHTML = '';
    noResults.classList.remove('hidden');
    label.textContent = `Aucun résultat pour « ${query} »`;
  } else {
    noResults.classList.add('hidden');
    resultsGrid.innerHTML = '';
    matches.forEach(card => resultsGrid.appendChild(card));
    const s = matches.length > 1 ? 's' : '';
    label.textContent = `${matches.length} pizza${s} trouvée${s} pour « ${query} »`;
    animateCards(resultsGrid);
  }
});

// ── Copie code promo ─────────────────────────────────────
function copyPromo() {
  const code = document.getElementById('promo-code').textContent;
  const btn  = document.getElementById('btn-copy');

  try {
    navigator.clipboard.writeText(code);
  } catch {
    // Fallback pour anciens navigateurs
    const ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  btn.textContent = '✓ Copié !';
  setTimeout(() => { btn.textContent = 'Copier'; }, 2000);
}

// ── Header shrink au scroll ──────────────────────────────
const header = document.getElementById('header');
let lastScroll = 0;

// IntersectionObserver pour basculer le style du header au passage du hero
const heroSection = document.querySelector('.hero');
if (heroSection) {
  const heroObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        header.classList.remove('past-hero');
      } else {
        header.classList.add('past-hero');
      }
    },
    { threshold: 0, rootMargin: '-62px 0px 0px 0px' }
  );
  heroObserver.observe(heroSection);
}

window.addEventListener('scroll', () => {
  const scrollY = window.scrollY;

  // Toggle scrolled class for glassmorphism effect
  if (scrollY > 20) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }

  if (scrollY > 80) {
    header.style.boxShadow = '0 4px 24px rgba(0,0,0,.15)';
  } else {
    header.style.boxShadow = '0 2px 12px rgba(0,0,0,.08)';
  }

  // Cache le CTA flottant quand on est sur la section commander
  const cmdSection = document.getElementById('commander');
  const floatingCta = document.getElementById('floating-cta');
  if (floatingCta && cmdSection) {
    const rect = cmdSection.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      floatingCta.style.display = 'none';
    } else if (window.innerWidth < 768) {
      floatingCta.style.display = 'block';
    }
  }

  lastScroll = scrollY;
}, { passive: true });

// Paiement via Stripe Checkout hébergé (redirect) — Stripe.js non requis côté client

// ── Modal personnalisation pizza ──────────────────────────
const EXTRAS = [
  'Crème fraiche','Sauce tomate','Champignons frais','Tomates cerises','Olives','Anchois',
  'Câpres','Chèvre','Brie','Raclette','Emmental rapé','Artichauts',
  'Aubergines grillées','Viande hachée','Merguez','Poivrons',
  'Poulet mariné','Miel','Lardons de veau','Jambon de dinde','Chorizo de boeuf'
];

const pizzaModal    = document.getElementById('pizza-modal');
const modalClose    = document.getElementById('modal-close');
const modalConfirm  = document.getElementById('modal-confirm');
const modalRemoveEl = document.getElementById('modal-remove');
const modalAddEl    = document.getElementById('modal-add');
const modalTotalEl  = document.getElementById('modal-total');

// Délégation unique sur le container des extras (résistant aux remplacements d'innerHTML)
modalAddEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-extra]');
  if (!btn) return;
  changeExtra(btn.getAttribute('data-extra'), parseInt(btn.getAttribute('data-delta'), 10));
});

let currentModal  = null;
let extrasCount   = {}; // { 'Jambon': 2, 'Mozzarella': 1, ... }

function changeExtra(name, delta) {
  extrasCount[name] = Math.max(0, (extrasCount[name] || 0) + delta);
  const row = modalAddEl.querySelector(`[data-extra-name="${name}"]`);
  if (row) {
    row.querySelector('.extra-count').textContent = extrasCount[name];
    row.classList.toggle('has-qty', extrasCount[name] > 0);
  }
  updateModalTotal();
}

// Event delegation for pizza base radio buttons (data-select-id / data-base)
document.getElementById('menu').addEventListener('change', (e) => {
  const radio = e.target.closest('input[type="radio"][data-select-id]');
  if (radio) filterBasePizzas(radio.dataset.selectId, radio.dataset.base);
});

// ── Délégation sur le conteneur menu ─────────────────────
document.getElementById('menu').addEventListener('click', (e) => {
  // Bouton "Composer ma formule"
  const formuleBtn = e.target.closest('.btn-formule');
  if (formuleBtn) { e.stopPropagation(); openFormuleModal(formuleBtn.dataset.formule); return; }

  // Panizza selector — each option opens the modal directly
  const panizzaBtn = e.target.closest('.btn-panizza-add');
  if (panizzaBtn) {
    e.stopPropagation();
    const name      = panizzaBtn.dataset.name;
    const desc      = panizzaBtn.dataset.desc;
    const basePrice = parseFloat(panizzaBtn.dataset.price);
    const priceText = panizzaBtn.dataset.price.replace('.', ',') + '€';
    openPizzaModalFull(name, desc, priceText, basePrice, false);
    return;
  }

  const btn = e.target.closest('.btn-add');
  if (!btn) return;
  e.stopPropagation();

  const drinkCard = btn.closest('.drink-card');
  if (drinkCard) { addDrinkToCart(drinkCard); return; }

  const hdCard = btn.closest('.hd-card');
  if (hdCard) { openHdModal(hdCard); return; }

  const pizzaCard = btn.closest('.pizza-card');
  if (pizzaCard) openPizzaModal(pizzaCard);
});

// ── Boissons : ajout direct ───────────────────────────────
function addDrinkToCart(drinkCard) {
  const name  = drinkCard.dataset.name;
  const price = parseFloat(drinkCard.dataset.price || '0');
  addToCart({ name, desc: '', price, type: 'boisson' });
}

// ── Häagen-Dazs : choix du parfum ────────────────────────
let selectedHdFlavor = null;  // tracké via event, plus fiable que :checked sur input caché

function openHdModal(hdCard) {
  resetPizzaModalSections();
  selectedHdFlavor = null;

  const strong    = hdCard.querySelector('strong');
  const priceEl   = hdCard.querySelector('.hd-price');
  const name      = strong?.textContent.trim() || 'Glace';
  const priceText = priceEl?.textContent || '0€';
  const basePrice = parseFloat(priceText.replace('€','').replace(',','.'));

  document.getElementById('modal-pizza-name').textContent     = name;
  document.getElementById('modal-pizza-desc').textContent     = 'Choisissez votre parfum';
  document.getElementById('modal-base-price-val').textContent = priceText;

  // Masquer la section "retirer"
  document.getElementById('modal-remove').closest('.modal-section').style.display = 'none';

  // Section "ajouter" → boutons parfum
  const addSection = document.getElementById('modal-add').closest('.modal-section');
  addSection.querySelector('h4').innerHTML = 'Choisir le parfum <span class="modal-note">obligatoire</span>';
  modalAddEl.innerHTML = ['Vanille 🍦','Fraise 🍓','Chocolat 🍫'].map(f => {
    const key = f.split(' ')[0]; // "Vanille", "Fraise", "Chocolat"
    return `<button type="button" class="hd-flavor-btn" data-flavor="${key}">${f}</button>`;
  }).join('');

  // Sélection du parfum via boutons
  modalAddEl.querySelectorAll('.hd-flavor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modalAddEl.querySelectorAll('.hd-flavor-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedHdFlavor = btn.dataset.flavor;
    });
  });

  currentModal = { name, desc: '', basePrice, ingredients: [], isHd: true };
  modalTotalEl.textContent = priceText;

  pizzaModal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

// ── Formules ──────────────────────────────────────────────
const formuleModal   = document.getElementById('formule-modal');
const formuleConfirm = document.getElementById('formule-confirm');
const formuleTotalEl = document.getElementById('formule-total');
let currentFormule   = null;

function getPizzaOptions() {
  return [...document.querySelectorAll('#tab-tomate .pizza-card, #tab-creme .pizza-card')]
    .map(c => {
      const n = c.querySelector('h3')?.textContent.trim();
      const p = parseFloat((c.querySelector('.pizza-price strong')?.textContent || '0€').replace('€','').replace(',','.'));
      const base = c.closest('#tab-tomate') ? 'tomate' : 'creme';
      return { name: n, price: p, base };
    }).filter(o => o.name);
}

// Stockage global des options par selectId (évite le problème innerHTML+<script>)
const _basePizzaOpts = {};

function buildBasePizzaSelectHtml(id, label, allPizzas) {
  const tomate = allPizzas.filter(p => p.base === 'tomate');
  const creme  = allPizzas.filter(p => p.base === 'creme');
  _basePizzaOpts[id] = { tomate, creme };
  const radioName = `base-${id}`;
  return `
    <div class="formule-select-group formule-base-group">
      <label>${label}</label>
      <div class="base-radio-row">
        <label class="base-radio-label">
          <input type="radio" name="${radioName}" value="tomate" checked data-select-id="${id}" data-base="tomate">
          <span>🍅 Base Tomate</span>
        </label>
        <label class="base-radio-label">
          <input type="radio" name="${radioName}" value="creme" data-select-id="${id}" data-base="creme">
          <span>🥛 Base Crème Fraîche</span>
        </label>
      </div>
      <select id="${id}" class="formule-pizza-select">
        <option value="">-- Choisir une pizza --</option>
        ${tomate.map(o => `<option value="${o.name}" data-price="${o.price}" data-base="tomate">${o.name} (${o.price.toFixed(2).replace('.',',')}€)</option>`).join('')}
      </select>
    </div>`;
}

function filterBasePizzas(selectId, base) {
  const opts = _basePizzaOpts[selectId];
  if (!opts) return;
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Choisir une pizza --</option>' +
    opts[base].map(o => `<option value="${o.name}" data-price="${o.price}" data-base="${base}">${o.name} (${o.price.toFixed(2).replace('.',',')}€)</option>`).join('');
  updateFormuleTotal();
}

function getPanizzaOptions() {
  return [...document.querySelectorAll('#tab-sandwichs .pizza-card')].filter(c => {
    return c.closest('.menu-subsection')?.querySelector('.subsection-title')?.textContent === 'Panizza';
  }).map(c => ({
    name: c.querySelector('h3')?.textContent.trim(),
    price: parseFloat((c.querySelector('.item-price')?.textContent || '0€').replace('€','').replace(',','.'))
  }));
}

function buildSelectHtml(id, label, options) {
  return `
    <div class="formule-select-group">
      <label for="${id}">${label}</label>
      <select id="${id}" class="formule-pizza-select">
        <option value="">-- Choisir --</option>
        ${options.map(o => `<option value="${o.name}" data-price="${o.price}">${o.name} (${o.price.toFixed(2).replace('.',',')}€)</option>`).join('')}
      </select>
    </div>`;
}

function openFormuleModal(type) {
  // Menu Midi : uniquement Mar–Dim 11h00–15h00
  if (type === 'midi') {
    const _n = new Date(), _day = _n.getDay(), _hm = _n.getHours() * 60 + _n.getMinutes();
    if (_day === 1 || _hm < 11 * 60 || _hm >= 15 * 60) {
      alert('Le Menu Midi est disponible uniquement du mardi au dimanche entre 11h00 et 15h00 🕚');
      return;
    }
  }
  const pizzas   = getPizzaOptions();
  const panizzas = getPanizzaOptions();
  const bouteilles = [
    { name: 'Coca-Cola 1,25L', price: 4 },
    { name: 'Coca-Cola Zéro 1,25L', price: 4 },
    { name: 'Ice Tea 1,25L', price: 4 },
    { name: 'Fanta orange 1,25L', price: 4 },
  ];

  let title = '', desc = '', bodyHtml = '';

  if (type === 'gourmand') {
    title = 'Menu Gourmand';
    desc  = '3 pizzas au choix + 1 bouteille 1,25L';
    bodyHtml = `
      <p class="formule-section-title">Choisissez vos 3 pizzas</p>
      ${buildBasePizzaSelectHtml('fg-p1', 'Pizza n°1', pizzas)}
      ${buildBasePizzaSelectHtml('fg-p2', 'Pizza n°2', pizzas)}
      ${buildBasePizzaSelectHtml('fg-p3', 'Pizza n°3', pizzas)}
      <p class="formule-section-title">Choisissez votre bouteille</p>
      ${buildSelectHtml('fg-boit', 'Bouteille 1,25L', bouteilles)}`;
  } else if (type === 'midi') {
    const canettes = [
      { name: 'Coca-Cola 33cl',       price: 0 },
      { name: 'Coca-Cola Zéro 33cl',  price: 0 },
      { name: 'Tropico 33cl',    price: 0 },
      { name: 'Sprite 33cl',          price: 0 },
      { name: 'Ice tera 33cl',         price: 0 },
      { name: 'Oasis tropical  33cl',   price: 0 },
    ];
    title = 'Menu Midi';
    desc  = 'Mar–Dim · À emporter · pizza ou panizza + canette offerte';
    bodyHtml = `
      <p class="formule-section-title">Votre plat</p>
      <div class="formule-radio-group" id="midi-type">
        <label class="formule-radio-label"><input type="radio" name="midi-plat-type" value="pizza" checked><span>🍕 Pizza</span></label>
        <label class="formule-radio-label"><input type="radio" name="midi-plat-type" value="panizza"><span>🥙 Panizza</span></label>
      </div>
      <div id="midi-pizza-wrap">${buildBasePizzaSelectHtml('fm-pizza', 'Pizza au choix', pizzas)}</div>
      <div id="midi-panizza-wrap" style="display:none">${buildSelectHtml('fm-panizza', 'Panizza au choix', panizzas)}</div>
      <p class="formule-section-title">Votre canette <span style="font-size:.78rem;color:var(--green);font-weight:700;">offerte 🎁</span></p>
      ${buildSelectHtml('fm-canette', 'Canette au choix', canettes)}`;
  } else if (type === 'exclusive') {
    title = '2+1 Offert';
    desc  = 'Lun–Jeu · À emporter · 2 pizzas achetées = 1 offerte';
    bodyHtml = `
      <p class="formule-section-title">Choisissez vos 2 pizzas (la 3ème sera identique à la 1ère)</p>
      ${buildBasePizzaSelectHtml('fe-p1', 'Pizza n°1 (+ 1 offerte identique)', pizzas)}
      ${buildBasePizzaSelectHtml('fe-p2', 'Pizza n°2', pizzas)}`;
  }

  document.getElementById('formule-modal-title').textContent = title;
  document.getElementById('formule-modal-desc').textContent  = desc;
  document.getElementById('formule-modal-body').innerHTML    = bodyHtml;

  currentFormule = { type };
  updateFormuleTotal();

  formuleModal.classList.add('is-open');
  document.body.style.overflow = 'hidden';

  // Switcher Pizza/Panizza pour Menu Midi
  if (type === 'midi') {
    document.querySelectorAll('[name="midi-plat-type"]').forEach(r => {
      r.addEventListener('change', () => {
        const isPizza = document.querySelector('[name="midi-plat-type"]:checked')?.value === 'pizza';
        document.getElementById('midi-pizza-wrap').style.display   = isPizza ? '' : 'none';
        document.getElementById('midi-panizza-wrap').style.display = isPizza ? 'none' : '';
        updateFormuleTotal();
      });
    });
  }

  // Update total on select change
  document.getElementById('formule-modal-body').addEventListener('change', updateFormuleTotal);
}

function updateFormuleTotal() {
  if (!currentFormule) return;
  const { type } = currentFormule;
  let total = 0;

  if (type === 'gourmand') {
    total = 37.90;
  } else if (type === 'midi') {
    const isPizza = document.querySelector('[name="midi-plat-type"]:checked')?.value === 'pizza';
    total = isPizza ? 12.90 : 9.90;
  } else if (type === 'exclusive') {
    // 2 pizzas payées + 1 offerte — seules les 2 premières sont facturées
    const p1 = document.getElementById('fe-p1');
    const p2 = document.getElementById('fe-p2');
    if (p1) total += parseFloat(p1.selectedOptions[0]?.dataset.price || 0);
    if (p2) total += parseFloat(p2.selectedOptions[0]?.dataset.price || 0);
  }

  formuleTotalEl.textContent = total > 0 ? total.toFixed(2).replace('.',',') + '€' : '—';
}

function closeFormuleModal() {
  formuleModal.classList.remove('is-open');
  document.body.style.overflow = '';
  currentFormule = null;
}

document.getElementById('formule-modal-close').addEventListener('click', closeFormuleModal);
formuleModal.addEventListener('click', e => { if (e.target === formuleModal) closeFormuleModal(); });

formuleConfirm.addEventListener('click', () => {
  if (!currentFormule) return;
  const { type } = currentFormule;
  const items = [];

  if (type === 'gourmand') {
    ['fg-p1','fg-p2','fg-p3'].forEach((id, i) => {
      const sel = document.getElementById(id);
      const n   = sel?.value;
      if (!n) { alert(`Veuillez choisir la pizza n°${i+1}`); throw new Error(); }
      items.push({ name: n, price: 0 }); // prix réparti sur le forfait
    });
    const bSel = document.getElementById('fg-boit');
    if (!bSel?.value) { alert('Veuillez choisir votre bouteille'); return; }
    items.push({ name: bSel.value, price: 0 });
    // Prix fixe forfait Gourmand
    items[0].price = 37.90;
  } else if (type === 'midi') {
    const isPizza = document.querySelector('[name="midi-plat-type"]:checked')?.value === 'pizza';
    const sel = document.getElementById(isPizza ? 'fm-pizza' : 'fm-panizza');
    if (!sel?.value) { alert('Veuillez choisir votre plat'); return; }
    const canSel = document.getElementById('fm-canette');
    if (!canSel?.value) { alert('Veuillez choisir votre canette'); return; }
    // Prix fixe : 12,90€ pizza / 9,90€ panizza — canette offerte incluse
    const fixedPrice = isPizza ? 12.90 : 9.90;
    items.push({ name: sel.value, price: fixedPrice });
    items.push({ name: `${canSel.value} (offerte)`, price: 0 });
  } else if (type === 'exclusive') {
    const p1 = document.getElementById('fe-p1');
    const p2 = document.getElementById('fe-p2');
    if (!p1?.value || !p2?.value) { alert('Veuillez choisir vos 2 pizzas'); return; }
    items.push({ name: p1.value, price: parseFloat(p1.selectedOptions[0]?.dataset.price || 0) });
    items.push({ name: p2.value, price: parseFloat(p2.selectedOptions[0]?.dataset.price || 0) });
    items.push({ name: `${p1.value} (offerte 🎁)`, price: 0 });
  }

  const total = items.reduce((s, i) => s + i.price, 0);
  const label = items.map(i => i.name).join(' + ');
  addToCart({ name: document.getElementById('formule-modal-title').textContent, desc: label, price: total, formuleType: type });
  closeFormuleModal();

  const cmdSection = document.getElementById('commander');
  if (cmdSection) window.scrollTo({ top: cmdSection.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
});

// Fermer modal formule sur Échap
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && formuleModal.classList.contains('is-open')) closeFormuleModal();
});

// ── Réinitialiser la modal pizza entre 2 ouvertures ───────
function resetPizzaModalSections() {
  const removeSection = document.getElementById('modal-remove').closest('.modal-section');
  const addSection    = document.getElementById('modal-add').closest('.modal-section');
  removeSection.style.display = '';
  addSection.style.display    = '';
  addSection.querySelector('h4').innerHTML = 'Ajouter des ingrédients <span class="modal-note">+2€ / ingrédient</span>';
}

function openPizzaModal(card) {
  resetPizzaModalSections();
  const isDessert = !!card.closest('#tab-desserts');

  const name      = card.querySelector('h3').textContent.trim();
  const desc      = card.querySelector('p')?.textContent.trim() || '';
  const priceEl   = card.querySelector('.pizza-price strong') || card.querySelector('.item-price');
  const priceText = priceEl?.textContent || '0€';
  const basePrice = parseFloat(priceText.replace('€','').replace(',','.'));

  // ── Calzone : étape 1 – choix de la viande ───────────────
  if (name === 'Calzone') {
    document.getElementById('modal-remove').closest('.modal-section').style.display = 'none';
    const addSection = document.getElementById('modal-add').closest('.modal-section');
    addSection.querySelector('h4').innerHTML = 'Choisir la viande <span class="modal-note">obligatoire</span>';
    modalAddEl.innerHTML = `
      <button type="button" class="hd-flavor-btn" data-meat="Bœuf haché">🥩 Bœuf haché</button>
      <button type="button" class="hd-flavor-btn" data-meat="Jambon">🍖 Jambon</button>`;
    modalAddEl.querySelectorAll('[data-meat]').forEach(btn => {
      btn.addEventListener('click', () => {
        modalAddEl.querySelectorAll('[data-meat]').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
    document.getElementById('modal-pizza-name').textContent     = name;
    document.getElementById('modal-pizza-desc').textContent     = 'Choisissez votre viande, puis personnalisez';
    document.getElementById('modal-base-price-val').textContent = priceText;
    modalTotalEl.textContent = priceText;
    modalConfirm.textContent = 'Suivant →';
    currentModal = { name, desc, basePrice, ingredients: [], isCalzoneMeatStep: true };
    pizzaModal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    return;
  }

  openPizzaModalFull(name, desc, priceText, basePrice, isDessert);
}

function openPizzaModalFull(name, desc, priceText, basePrice, isDessert, meatChoice = null) {
  resetPizzaModalSections();

  if (isDessert) {
    document.getElementById('modal-remove').closest('.modal-section').style.display = 'none';
    document.getElementById('modal-add').closest('.modal-section').style.display    = 'none';
  }

  const ingredients = desc.split(',').map(s => s.trim()).filter(Boolean);

  document.getElementById('modal-pizza-name').textContent     = name;
  document.getElementById('modal-pizza-desc').textContent     = desc;
  document.getElementById('modal-base-price-val').textContent = priceText;

  modalRemoveEl.innerHTML = ingredients.map((ing, i) => `
    <label class="modal-check-label">
      <input type="checkbox" class="modal-remove-check" data-idx="${i}">
      <span>${ing}</span>
    </label>`).join('');

  // Réinitialiser les compteurs d'extras
  extrasCount = {};
  modalAddEl.innerHTML = EXTRAS.map(ing => `
    <div class="extra-row" data-extra-name="${ing}">
      <span class="extra-name">${ing} <em>+2€</em></span>
      <div class="extra-counter">
        <button type="button" class="extra-btn extra-dec" data-extra="${ing}" data-delta="-1">−</button>
        <span class="extra-count">0</span>
        <button type="button" class="extra-btn extra-inc" data-extra="${ing}" data-delta="1">+</button>
      </div>
    </div>`).join('');


  modalConfirm.textContent = '🛒 Ajouter au panier';
  currentModal = { name, desc, basePrice, ingredients, meatChoice };
  updateModalTotal();

  // Ouvre la modal si elle n'est pas encore visible (appel initial hors Calzone step)
  if (!pizzaModal.classList.contains('is-open')) {
    pizzaModal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
}

function updateModalTotal() {
  if (!currentModal) return;
  const extrasTotal = Object.values(extrasCount).reduce((s, n) => s + n, 0);
  const total = currentModal.basePrice + extrasTotal * 2;
  modalTotalEl.textContent = total.toFixed(2).replace('.', ',') + '€';
}

function closePizzaModal() {
  pizzaModal.classList.remove('is-open');
  document.body.style.overflow = '';
  currentModal = null;
  modalConfirm.textContent = '🛒 Ajouter au panier';
}

// Fermer sur clic overlay (fond)
pizzaModal.addEventListener('click', (e) => {
  if (e.target === pizzaModal) closePizzaModal();
});

// Fermer sur bouton ✕
modalClose.addEventListener('click', closePizzaModal);

// Fermer sur Échap
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pizzaModal.classList.contains('is-open')) closePizzaModal();
});

// Mise à jour du total en temps réel
pizzaModal.addEventListener('change', updateModalTotal);

// Confirmer et ajouter au panier
modalConfirm.addEventListener('click', () => {
  if (!currentModal) return;

  // Étape 1 Calzone : choix de la viande → ouvre ensuite le modal complet
  if (currentModal.isCalzoneMeatStep) {
    const meatBtn = modalAddEl.querySelector('[data-meat].selected');
    if (!meatBtn) { alert('Veuillez choisir votre viande'); return; }
    const meat      = meatBtn.dataset.meat;
    const updatedDesc = currentModal.desc.replace('viande hachée au choix', meat);
    const priceText   = document.getElementById('modal-base-price-val').textContent;
    openPizzaModalFull(currentModal.name, updatedDesc, priceText, currentModal.basePrice, false, meat);
    return;
  }

  // Cas Häagen-Dazs
  if (currentModal.isHd) {
    if (!selectedHdFlavor) { alert('Veuillez choisir un parfum'); return; }
    addToCart({ name: `${currentModal.name} – ${selectedHdFlavor}`, desc: selectedHdFlavor, price: currentModal.basePrice });
    selectedHdFlavor = null;
    closePizzaModal();
    return;
  }

  const removed = [...pizzaModal.querySelectorAll('.modal-remove-check:checked')]
    .map(cb => currentModal.ingredients[+cb.dataset.idx]);

  // Construire la liste des extras avec quantités [{name, qty}]
  const addedItems = Object.entries(extrasCount)
    .filter(([, qty]) => qty > 0)
    .map(([name, qty]) => ({ name, qty }));

  const extrasFlat  = addedItems.flatMap(({ name, qty }) => Array(qty).fill(name));
  const finalPrice  = currentModal.basePrice + extrasFlat.length * 2;

  const keptIngredients = currentModal.ingredients.filter((_, i) =>
    !pizzaModal.querySelector(`.modal-remove-check[data-idx="${i}"]`)?.checked
  );
  const finalDesc = [...keptIngredients, ...extrasFlat].join(', ');

  addToCart({ name: currentModal.name, desc: finalDesc, price: finalPrice, removed, added: addedItems, meatChoice: currentModal.meatChoice || null });

  closePizzaModal();

  // Scroll vers la section commander
  const cmdSection = document.getElementById('commander');
  if (cmdSection) {
    window.scrollTo({ top: cmdSection.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
  }
});

// ── Panier ────────────────────────────────────────────────
const cart = [];

// Escape HTML — empêche XSS lors de l'injection de noms/descriptions dans innerHTML
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function addToCart(item) {
  cart.push({ ...item, qty: 1 });
  renderCart();

  // Scroll vers la section panier
  const cmdSection = document.getElementById('commander');
  if (cmdSection) {
    window.scrollTo({ top: cmdSection.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
  }
}

function renderCart() {
  const container = document.getElementById('stripe-cart');
  const summary   = document.getElementById('cart-summary');
  const totalEl   = document.getElementById('cart-total');

  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = '<p class="cart-empty">Ton panier est vide — ajoute des pizzas depuis le menu ci-dessus</p>';
    summary?.classList.add('hidden');
    return;
  }

  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  container.innerHTML = cart.map((item, idx) => {
    let customHtml = '';
    // Choix de viande (Calzone) — toujours affiché en premier
    if (item.meatChoice) {
      customHtml += `<div class="cart-item-custom cart-item-meat">🥩 ${esc(item.meatChoice)}</div>`;
    }
    if (item.removed?.length || item.added?.length) {
      if (item.removed?.length)
        customHtml += `<div class="cart-item-custom"><span class="removed">−&nbsp;${item.removed.map(esc).join(', ')}</span></div>`;
      if (item.added?.length)
        customHtml += `<div class="cart-item-custom"><span class="added">+&nbsp;${item.added.map(a => `${a.qty > 1 ? a.qty + '× ' : ''}${esc(a.name)} <em>(+${a.qty * 2}€)</em>`).join(' · ')}</span></div>`;
    } else if (!item.meatChoice && item.desc) {
      // Détail pour formules, glaces, etc.
      customHtml += `<div class="cart-item-custom cart-item-desc">${esc(item.desc)}</div>`;
    }
    return `
    <div class="cart-item">
      <div class="cart-item-name">
        <span>${esc(item.name)}</span>
        ${customHtml}
      </div>
      <div class="cart-item-qty">
        <button data-idx="${idx}" data-delta="-1">−</button>
        <span>${item.qty}</span>
        <button data-idx="${idx}" data-delta="1">+</button>
        <span>${(item.price * item.qty).toFixed(2).replace('.',',')}€</span>
      </div>
    </div>`;
  }).join('');

  // Attacher les listeners directement sur les boutons quantité du panier
  container.querySelectorAll('[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => changeQty(parseInt(btn.dataset.idx, 10), parseInt(btn.dataset.delta, 10)));
  });

  if (totalEl) totalEl.textContent = `${total.toFixed(2).replace('.',',')}€`;
  summary?.classList.remove('hidden');

  // Notice minimum de commande
  const minNotice = document.getElementById('cart-min-notice');
  const deliveryBtns = document.getElementById('cart-delivery-btns');
  if (minNotice) {
    const belowMin = total < 20;
    minNotice.style.display = belowMin ? 'flex' : 'none';
    if (deliveryBtns) deliveryBtns.style.pointerEvents = belowMin ? 'none' : '';
    if (deliveryBtns) deliveryBtns.style.opacity = belowMin ? '0.35' : '';
  }
}

function changeQty(idx, delta) {
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) cart.splice(idx, 1);
  renderCart();
}


// ── Choix livraison / à emporter ─────────────────────────
let deliveryInfo = null;  // { mode: 'livraison'|'emporter', address?, code?, phone? }

const deliveryModal      = document.getElementById('delivery-modal');
const deliveryModalClose = document.getElementById('delivery-modal-close');
const deliveryForm       = document.getElementById('delivery-form');

// Formules disponibles uniquement à emporter
const EMPORTER_ONLY = ['midi', 'exclusive'];

document.getElementById('btn-livraison').addEventListener('click', () => {
  // Vérifier si le panier contient des formules non livrables
  const blocked = cart.filter(i => EMPORTER_ONLY.includes(i.formuleType));
  if (blocked.length) {
    const names = blocked.map(i => `• ${i.name}`).join('\n');
    alert(`Les articles suivants sont disponibles uniquement à emporter :\n${names}\n\nRetirez-les du panier pour commander en livraison, ou choisissez "À emporter".`);
    return;
  }
  document.getElementById('btn-livraison').classList.add('active');
  document.getElementById('btn-emporter').classList.remove('active');
  // Réinitialiser le formulaire et les erreurs
  deliveryForm.reset();
  ['d-firstname','d-lastname','d-phone','d-address'].forEach(id => {
    document.getElementById(id)?.classList.remove('input-error');
  });
  ['d-firstname-err','d-lastname-err','d-phone-err','d-address-err'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '';
  });
  deliveryModal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
});

document.getElementById('btn-emporter').addEventListener('click', () => {
  document.getElementById('btn-emporter').classList.add('active');
  document.getElementById('btn-livraison').classList.remove('active');
  // Ouvrir la mini-modal emporter (collecte prénom + téléphone + email optionnel)
  document.getElementById('emporter-form').reset();
  document.getElementById('e-promo-badge').style.display = 'none';
  document.getElementById('emporter-modal').classList.add('is-open');
  document.body.style.overflow = 'hidden';
});

// ── Modal emporter ────────────────────────────────────────
const emporterModal = document.getElementById('emporter-modal');
document.getElementById('emporter-modal-close').addEventListener('click', () => {
  emporterModal.classList.remove('is-open');
  document.body.style.overflow = '';
  document.getElementById('btn-emporter').classList.remove('active');
});
emporterModal.addEventListener('click', e => {
  if (e.target === emporterModal) document.getElementById('emporter-modal-close').click();
});
document.getElementById('emporter-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const firstname = document.getElementById('e-firstname').value.trim();
  const phone     = document.getElementById('e-phone').value.trim();
  const email     = document.getElementById('e-email').value.trim();

  let valid = true;
  if (!firstname) {
    document.getElementById('e-firstname').classList.add('input-error');
    document.getElementById('e-firstname-err').textContent = 'Le prénom est obligatoire';
    valid = false;
  } else {
    document.getElementById('e-firstname').classList.remove('input-error');
    document.getElementById('e-firstname-err').textContent = '';
  }
  if (!phone) {
    document.getElementById('e-phone').classList.add('input-error');
    document.getElementById('e-phone-err').textContent = 'Le téléphone est obligatoire';
    valid = false;
  } else {
    document.getElementById('e-phone').classList.remove('input-error');
    document.getElementById('e-phone-err').textContent = '';
  }
  if (!valid) return;

  deliveryInfo = { mode: 'emporter', firstname, phone, email: email || '' };
  emporterModal.classList.remove('is-open');
  document.body.style.overflow = '';
  payWithStripe();
});

deliveryModalClose.addEventListener('click', () => {
  deliveryModal.classList.remove('is-open');
  document.body.style.overflow = '';
  // Désactiver le bouton livraison si on ferme sans valider
  document.getElementById('btn-livraison').classList.remove('active');
});
deliveryModal.addEventListener('click', e => {
  if (e.target === deliveryModal) deliveryModalClose.click();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && deliveryModal.classList.contains('is-open')) deliveryModalClose.click();
});

deliveryForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const fields = {
    firstname: { val: document.getElementById('d-firstname').value.trim(), required: true,  errId: 'd-firstname-err', msg: 'Le prénom est obligatoire' },
    lastname:  { val: document.getElementById('d-lastname').value.trim(),  required: true,  errId: 'd-lastname-err',  msg: 'Le nom est obligatoire' },
    phone:     { val: document.getElementById('d-phone').value.trim(),     required: true,  errId: 'd-phone-err',     msg: 'Le téléphone est obligatoire' },
    address:   { val: document.getElementById('d-address').value.trim(),   required: true,  errId: 'd-address-err',   msg: 'L\'adresse est obligatoire' },
    zip:       { val: document.getElementById('d-zip').value.trim(),       required: true,  errId: 'd-zip-err',       msg: 'Le code postal est obligatoire' },
    city:      { val: document.getElementById('d-city').value.trim(),      required: true,  errId: 'd-city-err',      msg: 'La ville est obligatoire' },
  };

  let valid = true;
  for (const [id, f] of Object.entries(fields)) {
    const input = document.getElementById(`d-${id}`);
    const errEl = document.getElementById(f.errId);
    if (f.required && !f.val) {
      input.classList.add('input-error');
      errEl.textContent = f.msg;
      valid = false;
    } else {
      input.classList.remove('input-error');
      errEl.textContent = '';
    }
  }
  if (!valid) return;

  deliveryInfo = {
    mode:      'livraison',
    firstname: fields.firstname.val,
    lastname:  fields.lastname.val,
    phone:     fields.phone.val,
    address:   fields.address.val,
    zip:       fields.zip.val,
    city:      fields.city.val,
    floor:     document.getElementById('d-floor').value.trim(),
    appt:      document.getElementById('d-appt').value.trim(),
    building:  document.getElementById('d-building').value.trim(),
    code:      document.getElementById('d-code').value.trim(),
    notes:     document.getElementById('d-notes').value.trim(),
  };

  deliveryModal.classList.remove('is-open');
  document.body.style.overflow = '';
  payWithStripe();
});

// ── Vérification promo temps réel ────────────────────────
let promoState = { eligible: false, email: '' };
let promoTimer = null;

function checkPromo(email, badgeId) {
  clearTimeout(promoTimer);
  const badge = document.getElementById(badgeId);
  if (!email || !email.includes('@')) {
    promoState = { eligible: false, email: '' };
    if (badge) badge.style.display = 'none';
    return;
  }
  promoTimer = setTimeout(async () => {
    try {
      const res  = await fetch(`/api/check-promo?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      promoState = { eligible: data.eligible, email };
      if (badge) badge.style.display = data.eligible ? 'block' : 'none';
    } catch {
      promoState = { eligible: false, email: '' };
    }
  }, 500);
}

// Écoute sur les champs email des deux modals
document.getElementById('d-email').addEventListener('input', e => {
  checkPromo(e.target.value.trim(), 'd-promo-badge');
});
document.getElementById('e-email').addEventListener('input', e => {
  checkPromo(e.target.value.trim(), 'e-promo-badge');
});

// ── Paiement Stripe ───────────────────────────────────────
async function payWithStripe() {
  // Filet de sécurité : vérifier une dernière fois que le resto est ouvert
  if (!restaurantOpen) {
    alert('Le restaurant est actuellement fermé. Les commandes en ligne ne sont pas disponibles pour le moment.');
    return;
  }

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);

  // Bloquer les formules emporter-only en livraison
  if (deliveryInfo?.mode === 'livraison') {
    const blocked = cart.filter(i => EMPORTER_ONLY.includes(i.formuleType));
    if (blocked.length) {
      const names = blocked.map(i => `• ${i.name}`).join('\n');
      alert(`Les articles suivants sont disponibles uniquement à emporter :\n${names}`);
      return;
    }
  }

  // Minimum 20€ pour toute commande
  if (total < 20) {
    alert(`Commande minimum 20€.\nVotre panier : ${total.toFixed(2).replace('.', ',')}€`);
    return;
  }

  const submitBtn = deliveryForm.querySelector('[type="submit"]');
  const emporterBtn = document.getElementById('btn-emporter');
  const activeBtn = deliveryInfo?.mode === 'emporter' ? emporterBtn : submitBtn;

  if (activeBtn) { activeBtn.disabled = true; activeBtn.textContent = 'Redirection...'; }

  try {
    // Récupère l'email promo selon le mode (livraison = d-email, emporter = e-email via deliveryInfo)
    const promoEmail = deliveryInfo?.mode === 'livraison'
      ? document.getElementById('d-email').value.trim()
      : (deliveryInfo?.email || '');

    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items:      cart,
        delivery:   deliveryInfo,
        applyPromo: promoState.eligible && promoState.email === promoEmail,
        promoEmail: promoEmail || undefined,
      }),
    });

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert(data.error || 'Erreur de paiement');
      if (activeBtn) { activeBtn.disabled = false; activeBtn.textContent = deliveryInfo?.mode === 'emporter' ? '🏠 À emporter' : '💳 Confirmer et payer'; }
    }
  } catch (err) {
    alert('Erreur réseau, réessaie.');
    if (activeBtn) { activeBtn.disabled = false; activeBtn.textContent = deliveryInfo?.mode === 'emporter' ? '🏠 À emporter' : '💳 Confirmer et payer'; }
  }
}

// ── Animation apparition au scroll ──────────────────────
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.1 });

// Only observe non-pizza elements + the initially active tab (classiques)
document.querySelectorAll('.avis-card, .livraison-card, .order-option').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity .4s ease, transform .4s ease';
  observer.observe(el);
});

// Animate initial tab (tomate)
const initialTab = document.getElementById('tab-tomate');
if (initialTab) {
  initialTab.querySelectorAll('.pizza-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity .4s ease, transform .4s ease';
    observer.observe(el);
  });
}

// ── Smooth scroll offset pour header fixe ────────────────
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', (e) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    const offset = 70;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

// ── Cookie consent banner ─────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;
  if (!localStorage.getItem('cookie_consent')) banner.style.display = 'flex';
  document.getElementById('cookie-refuse').addEventListener('click', () => {
    localStorage.setItem('cookie_consent', 'refused');
    banner.style.display = 'none';
  });
  document.getElementById('cookie-accept').addEventListener('click', () => {
    localStorage.setItem('cookie_consent', 'accepted');
    banner.style.display = 'none';
  });
});

