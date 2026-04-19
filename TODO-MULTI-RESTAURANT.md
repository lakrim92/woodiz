# TODO — Multi-restaurant (Panuozzo + My Thai)

## Contexte
Les deux restaurants partagent le même compte Stripe.
Chaque commande a un champ `metadata.source` :
- `site_panuozzo` → commandes Panuozzo (woodiz)
- `site_mythai` → commandes My Thai (mythai)

Les données sont stockées dans deux `orders.json` séparés :
- `~/workspace/woodiz/orders.json` → Panuozzo
- `~/workspace/mythai/orders.json` → My Thai

---

## tablette.html

- [ ] Ajouter un sélecteur de restaurant en haut (Panuozzo / My Thai / Les deux)
- [ ] Fetcher les commandes des deux serveurs (`localhost:3005` et `localhost:3006`)
- [ ] Fusionner et trier par date si vue "Les deux"
- [ ] Distinguer visuellement les commandes par restaurant (badge coloré)
- [ ] SSE : écouter les deux streams en parallèle (sinon une commande My Thai ne sonne pas si la tablette est sur l'onglet Panuozzo)

## admin.html

- [ ] Ajouter filtre par restaurant dans la liste des commandes
- [ ] Stats séparées par restaurant + vue consolidée
- [ ] Export CSV avec colonne `restaurant`
- [ ] Adapter les graphiques pour afficher les deux courbes

## Divers

- [ ] Vérifier que les deux `STRIPE_WEBHOOK_SECRET` sont bien distincts dans chaque `.env`
- [ ] S'assurer que les ports (3005 / 3006) sont bien exposés via Nginx avec les bons domaines
