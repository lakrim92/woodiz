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

// Close nav when clicking outside
document.addEventListener('click', (e) => {
  if (!burger.contains(e.target) && !mobileNav.contains(e.target)) {
    mobileNav.classList.remove('open');
  }
});

// ── Statut ouvert/fermé ──────────────────────────────────
function updateStatut() {
  const el = document.getElementById('statut-ouvert');
  if (!el) return;

  const now = new Date();
  const day = now.getDay();  // 0 = dim, 1 = lun, ..., 6 = sam
  const h   = now.getHours();
  const m   = now.getMinutes();
  const hm  = h * 60 + m;  // minutes depuis minuit

  // Horaires : lun-sam 11h00-14h30 & 18h00-23h00 / dim 18h00-23h00
  const midi_open  = 11 * 60;
  const midi_close = 14 * 60 + 30;
  const soir_open  = 18 * 60;
  const soir_close = 23 * 60;

  let isOpen = false;

  if (day >= 1 && day <= 6) {
    // Lun–Sam
    isOpen = (hm >= midi_open && hm < midi_close) || (hm >= soir_open && hm < soir_close);
  } else if (day === 0) {
    // Dimanche
    isOpen = hm >= soir_open && hm < soir_close;
  }

  if (isOpen) {
    el.innerHTML = '<span style="color:#4ade80;font-weight:700;">● Ouvert maintenant</span>';
  } else {
    // Calcule prochaine ouverture
    let next = '';
    if (day === 0 && hm < soir_open) next = 'Ouvre ce soir à 18h00';
    else if (hm < midi_open && day >= 1 && day <= 6) next = 'Ouvre à 11h00';
    else if (hm >= midi_close && hm < soir_open && day >= 1 && day <= 6) next = 'Ouvre à 18h00';
    else next = 'Ouvre demain à 11h00';
    el.innerHTML = `<span style="color:#fbbf24;font-weight:700;">● Fermé — ${next}</span>`;
  }
}

updateStatut();
setInterval(updateStatut, 60_000);

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

// ── Extras toggle ─────────────────────────────────────────
document.getElementById('extras-toggle').addEventListener('click', () => {
  const list = document.getElementById('extras-list');
  const tag  = document.querySelector('.extras-tag');
  if (list.hasAttribute('hidden')) {
    list.removeAttribute('hidden');
    if (tag) tag.textContent = 'Masquer ▲';
  } else {
    list.setAttribute('hidden', '');
    if (tag) tag.textContent = 'Voir la liste complète ▼';
  }
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

// ── Chargement Stripe.js ─────────────────────────────────
(function() {
  const s = document.createElement('script');
  s.src = 'https://js.stripe.com/v3/';
  s.defer = true;
  document.head.appendChild(s);
})();

// ── Modal personnalisation pizza ──────────────────────────
const EXTRAS = [
  'Anchois','Artichaut','Avocat','Champignons','Chèvre','Chorizo',
  'Cornichons','Feta','Gorgonzola','Jambon','Jambon de Parme','Lardons',
  'Merguez','Mozzarella ×2','Œuf','Olives','Oignons','Parmesan',
  'Pepperoni','Poivrons','Poulet','Roquette','Saumon fumé','Thon',
  'Tomates fraîches'
];

const pizzaModal    = document.getElementById('pizza-modal');
const modalClose    = document.getElementById('modal-close');
const modalConfirm  = document.getElementById('modal-confirm');
const modalRemoveEl = document.getElementById('modal-remove');
const modalAddEl    = document.getElementById('modal-add');
const modalTotalEl  = document.getElementById('modal-total');

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

// ── Délégation sur le conteneur menu ─────────────────────
document.getElementById('menu').addEventListener('click', (e) => {
  // Bouton "Composer ma formule"
  const formuleBtn = e.target.closest('.btn-formule');
  if (formuleBtn) { e.stopPropagation(); openFormuleModal(formuleBtn.dataset.formule); return; }

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
  addToCart({ name, desc: '', price });
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
      return { name: n, price: p };
    }).filter(o => o.name);
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
  const pizzas   = getPizzaOptions();
  const panizzas = getPanizzaOptions();
  const bouteilles = [
    { name: 'Coca-Cola 1,25L', price: 4 },
    { name: 'Fanta Orange 1,25L', price: 4 },
    { name: 'Sprite 1,25L', price: 4 },
    { name: 'Ice Tea Pêche 1,25L', price: 4 },
  ];

  let title = '', desc = '', bodyHtml = '';

  if (type === 'gourmand') {
    title = 'Menu Gourmand';
    desc  = '3 pizzas au choix + 1 bouteille 1,25L';
    bodyHtml = `
      <p class="formule-section-title">Choisissez vos 3 pizzas</p>
      ${buildSelectHtml('fg-p1', 'Pizza n°1', pizzas)}
      ${buildSelectHtml('fg-p2', 'Pizza n°2', pizzas)}
      ${buildSelectHtml('fg-p3', 'Pizza n°3', pizzas)}
      <p class="formule-section-title">Choisissez votre bouteille</p>
      ${buildSelectHtml('fg-boit', 'Bouteille 1,25L', bouteilles)}`;
  } else if (type === 'midi') {
    const canettes = [
      { name: 'Coca-Cola 33cl',       price: 0 },
      { name: 'Coca-Cola Zéro 33cl',  price: 0 },
      { name: 'Fanta Orange 33cl',    price: 0 },
      { name: 'Sprite 33cl',          price: 0 },
      { name: 'Perrier 33cl',         price: 0 },
      { name: 'Ice Tea Pêche 33cl',   price: 0 },
    ];
    title = 'Menu Midi';
    desc  = 'À emporter · pizza ou panizza + canette offerte';
    bodyHtml = `
      <p class="formule-section-title">Votre plat</p>
      <div class="formule-radio-group" id="midi-type">
        <label class="formule-radio-label"><input type="radio" name="midi-plat-type" value="pizza" checked><span>🍕 Pizza</span></label>
        <label class="formule-radio-label"><input type="radio" name="midi-plat-type" value="panizza"><span>🥙 Panizza</span></label>
      </div>
      <div id="midi-pizza-wrap">${buildSelectHtml('fm-pizza', 'Pizza au choix', pizzas)}</div>
      <div id="midi-panizza-wrap" style="display:none">${buildSelectHtml('fm-panizza', 'Panizza au choix', panizzas)}</div>
      <p class="formule-section-title">Votre canette <span style="font-size:.78rem;color:var(--green);font-weight:700;">offerte 🎁</span></p>
      ${buildSelectHtml('fm-canette', 'Canette au choix', canettes)}`;
  } else if (type === 'exclusive') {
    title = '2+1 Offert';
    desc  = 'Lun–Jeu · À emporter · 2 pizzas achetées = 1 offerte';
    bodyHtml = `
      <p class="formule-section-title">Choisissez vos 2 pizzas (la 3ème sera identique à la 1ère)</p>
      ${buildSelectHtml('fe-p1', 'Pizza n°1 (+ 1 offerte)', pizzas)}
      ${buildSelectHtml('fe-p2', 'Pizza n°2', pizzas)}`;
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
  let total = 0;
  const { type } = currentFormule;

  if (type === 'gourmand') {
    ['fg-p1','fg-p2','fg-p3','fg-boit'].forEach(id => {
      const sel = document.getElementById(id);
      if (sel) total += parseFloat(sel.selectedOptions[0]?.dataset.price || 0);
    });
  } else if (type === 'midi') {
    const isPizza = document.querySelector('[name="midi-plat-type"]:checked')?.value === 'pizza';
    const selId = isPizza ? 'fm-pizza' : 'fm-panizza';
    const sel = document.getElementById(selId);
    if (sel) total += parseFloat(sel.selectedOptions[0]?.dataset.price || 0);
  } else if (type === 'exclusive') {
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
      const p   = parseFloat(sel?.selectedOptions[0]?.dataset.price || 0);
      if (!n) { alert(`Veuillez choisir la pizza n°${i+1}`); throw new Error(); }
      items.push({ name: n, price: p });
    });
    const bSel = document.getElementById('fg-boit');
    if (!bSel?.value) { alert('Veuillez choisir votre bouteille'); return; }
    items.push({ name: bSel.value, price: 4 });
  } else if (type === 'midi') {
    const isPizza = document.querySelector('[name="midi-plat-type"]:checked')?.value === 'pizza';
    const sel = document.getElementById(isPizza ? 'fm-pizza' : 'fm-panizza');
    if (!sel?.value) { alert('Veuillez choisir votre plat'); return; }
    const canSel = document.getElementById('fm-canette');
    if (!canSel?.value) { alert('Veuillez choisir votre canette'); return; }
    items.push({ name: sel.value, price: parseFloat(sel.selectedOptions[0]?.dataset.price || 0) });
    items.push({ name: `${canSel.value} (offerte)`, price: 0 });
  } else if (type === 'exclusive') {
    const p1 = document.getElementById('fe-p1');
    const p2 = document.getElementById('fe-p2');
    if (!p1?.value || !p2?.value) { alert('Veuillez choisir vos 2 pizzas'); return; }
    items.push({ name: p1.value, price: parseFloat(p1.selectedOptions[0]?.dataset.price || 0) });
    items.push({ name: p2.value, price: parseFloat(p2.selectedOptions[0]?.dataset.price || 0) });
    items.push({ name: `${p1.value} (offerte)`, price: 0 });
  }

  const total = items.reduce((s, i) => s + i.price, 0);
  const label = items.map(i => i.name).join(' + ');
  addToCart({ name: document.getElementById('formule-modal-title').textContent, desc: label, price: total });
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
        <button type="button" class="extra-btn extra-dec" onclick="changeExtra('${ing}', -1)">−</button>
        <span class="extra-count">0</span>
        <button type="button" class="extra-btn extra-inc" onclick="changeExtra('${ing}', +1)">+</button>
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
      customHtml += `<div class="cart-item-custom cart-item-meat">🥩 ${item.meatChoice}</div>`;
    }
    if (item.removed?.length || item.added?.length) {
      if (item.removed?.length)
        customHtml += `<div class="cart-item-custom"><span class="removed">−&nbsp;${item.removed.join(', ')}</span></div>`;
      if (item.added?.length)
        customHtml += `<div class="cart-item-custom"><span class="added">+&nbsp;${item.added.map(a => `${a.qty > 1 ? a.qty + '× ' : ''}${a.name} <em>(+${a.qty * 2}€)</em>`).join(' · ')}</span></div>`;
    } else if (!item.meatChoice && item.desc) {
      // Détail pour formules, glaces, etc.
      customHtml += `<div class="cart-item-custom cart-item-desc">${item.desc}</div>`;
    }
    return `
    <div class="cart-item">
      <div class="cart-item-name">
        <span>${item.name}</span>
        ${customHtml}
      </div>
      <div class="cart-item-qty">
        <button onclick="changeQty(${idx}, -1)">−</button>
        <span>${item.qty}</span>
        <button onclick="changeQty(${idx}, +1)">+</button>
        <span>${(item.price * item.qty).toFixed(2).replace('.',',')}€</span>
      </div>
    </div>`;
  }).join('');

  if (totalEl) totalEl.textContent = `${total.toFixed(2).replace('.',',')}€`;
  summary?.classList.remove('hidden');
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

document.getElementById('btn-livraison').addEventListener('click', () => {
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
  deliveryInfo = { mode: 'emporter' };
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

// ── Paiement Stripe ───────────────────────────────────────
async function payWithStripe() {
  const submitBtn = deliveryForm.querySelector('[type="submit"]');
  const emporterBtn = document.getElementById('btn-emporter');
  const activeBtn = deliveryInfo?.mode === 'emporter' ? emporterBtn : submitBtn;

  if (activeBtn) { activeBtn.disabled = true; activeBtn.textContent = 'Redirection...'; }

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart, delivery: deliveryInfo }),
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
