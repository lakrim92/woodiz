# SEO & Indexation Google — PANUOZZO Bougival

## Statut global : 🟢 Essentiel terminé

---

## ✅ Fait

- [x] `robots.txt` créé et live (`/robots.txt`)
- [x] `sitemap.xml` créé et live (`/sitemap.xml`)
- [x] `og-image.jpg` présente et au bon format (1200x630px)
- [x] `index.html` — Twitter Card ajoutée
- [x] `index.html` — OG enrichi (width, height, alt, site_name)
- [x] `index.html` — Favicons link tags (`rel="icon"`, `apple-touch-icon`)
- [x] `index.html` — Schema.org enrichi (image, hasMap, sameAs, menu, payment)
- [x] `index.html` — Schema.org : `logo` + `description` ajoutés
- [x] `admin.html` — `noindex, nofollow` (renforcé)
- [x] `tablette.html` — `noindex, nofollow` (renforcé)
- [x] Google Search Console — vérification DNS TXT ajoutée via Infomaniak API
- [x] Infomaniak API — token DNS configuré (`.env.infomaniak`)

---

## 🔴 À faire — PRIORITÉ HAUTE

### 1. Google Business Profile ✅
- [x] Fiche créée et complète (adresse, horaires, téléphone, site web, avis)

### 2. Google Search Console ✅
- [x] Sitemap soumis
- [x] Indexation demandée

---

## 🟡 À faire — PRIORITÉ MOYENNE

### 3. AggregateRating dans Schema.org
> Affiche les étoiles directement dans les résultats Google (très visible)
- [ ] Attendre d'avoir des avis Google (min. 5)
- [ ] Ajouter dans le Schema.org de `index.html` :
  ```json
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "reviewCount": "42"
  }
  ```
- [ ] Mettre à jour régulièrement avec les vrais chiffres Google

### 4. DMARC record DNS ✅
- [x] Ajouté via API Infomaniak (`_dmarc` TXT record)

---

## 🖨️ Imprimante thermique — En attente matériel

- [ ] **Connecter l'imprimante au WiFi** — deux candidats à tester demain :
  - `192.168.1.30` (imprimante principale — injoignable, vérifier WiFi/allumage)
  - `192.168.1.68` (deuxième imprimante — injoignable aussi)
- [ ] Une fois joignable, ajouter dans `.env` : `PRINTER_HOST=192.168.1.XX` et `PRINTER_PORT=9100`
- [ ] `pm2 restart panuozzo`

> ✅ **Déjà codé et prêt :**
> - Impression **automatique** à chaque nouvelle commande (dès paiement Stripe validé)
> - Bouton **réimpression manuelle** depuis la tablette (`POST /api/orders/:id/print`)
> - Il manque uniquement `PRINTER_HOST` dans `.env` pour activer

---

## 📱 Tablette — En cours

- [x] PWA installée (`display: fullscreen`, SW, WakeLock, reconnexion auto)
- [ ] Démarrage automatique au boot via **MacroDroid** (gratuit, Play Store)
  - Déclencheur : Démarrage de l'appareil → Action : Lancer PANUOZZO

---

## 🟢 Améliorations futures (optionnel)

- [ ] Pages dédiées par zone de livraison (Rueil, Chatou…) pour le SEO local
- [ ] Intégrer les avis Google Maps directement sur le site (widget)
- [ ] Schema.org `Review` et `AggregateRating` dès qu'on a des avis
- [ ] Tester OG image : https://developers.facebook.com/tools/debug/
- [ ] Surveiller Core Web Vitals dans Google Search Console (1x/semaine)
- [ ] Mettre à jour `sitemap.xml` → `<lastmod>` à chaque modification majeure

---

## 🔑 Ressources techniques

- Token API Infomaniak DNS : `.env.infomaniak` (sur le Pi)
- Domaine ID Infomaniak : `2135172`
- Endpoint DNS : `POST https://api.infomaniak.com/2/zones/panuozzo-bougival.fr/records`
