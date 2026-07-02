# Publication Chrome Web Store & Firefox Add-ons (AMO)

## Chrome Web Store

### Prérequis

- Un compte [Chrome Web Store Developer](https://chrome.google.com/webstore/devconsole) (frais unique de 5 USD).
- Une URL publique pour la politique de confidentialité (héberger `privacy-policy.html`, par exemple via GitHub Pages).

### Fichiers inclus dans le package

Le zip de publication doit contenir uniquement :

- `manifest.json`
- `popup.html`
- `content.js`
- `style.css`
- `page-bridge.js`
- `browser-polyfill.js`
- `icons/icon16.png`
- `icons/icon32.png`
- `icons/icon48.png`
- `icons/icon128.png`

Ne pas inclure : `.git`, `dist/`, `scripts/`, `EvaEvolved.png`, `manifest.firefox.json`, documentation interne.

### Créer le zip

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
```

Le fichier `dist/evassistant.zip` sera généré.

### Étapes de publication

1. Ouvrir le [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. **Nouvel élément** > charger `dist/evassistant.zip`.
3. Renseigner la fiche store :
   - **Nom** : Evassistant
   - **Description courte** : Participants EVA et favoris de réservation avec Evassistant.
   - **Description** : voir `store-listing.txt`
   - **Catégorie** : Productivité
   - **Langue** : Français
4. Ajouter l'icône store `icons/icon128.png`.
5. Ajouter au moins 1 capture d'écran (1280x800 ou 640x400 recommandé).
6. Indiquer l'URL de `privacy-policy.html` hébergée publiquement.
7. Déclarer les permissions :
   - `activeTab` : accès temporaire à l'onglet EVA quand l'utilisateur ouvre Evassistant.
   - `scripting` : relayer les appels API via la session EVA connectée.
8. Soumettre pour examen.

### Vérifications avant soumission

- [ ] Extension rechargée et testée sur `app.eva.gg` avec compte connecté.
- [ ] Evassistant ouvert depuis un onglet EVA actif (obligatoire).
- [ ] Onglet Favoris : création, ouverture, suppression OK.
- [ ] Onglets À venir / Historique : chargement OK.
- [ ] Aucune erreur dans la console de la popup.
- [ ] Version incrémentée dans `manifest.json`.

## Firefox Add-ons (AMO)

### Prérequis

- Un compte développeur gratuit sur [addons.mozilla.org](https://addons.mozilla.org/developers/).
- Une URL publique pour la politique de confidentialité (peut être la même que pour Chrome).

### Fichiers inclus dans le package

Le zip Firefox doit contenir uniquement (le script s'en charge automatiquement) :

- `manifest.json` (généré à partir de `manifest.firefox.json`)
- `popup.html`
- `content.js`
- `style.css`
- `page-bridge.js`
- `browser-polyfill.js`
- `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png`

### Créer le zip

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-extension-firefox.ps1
```

Le fichier `dist/evassistant-firefox.zip` sera généré, avec le bon
`manifest.json` (basé sur `manifest.firefox.json`, incluant
`browser_specific_settings`).

### Étapes de publication

1. Ouvrir [Developer Hub AMO](https://addons.mozilla.org/developers/addon/submit/distribution).
2. Choisir **Sur ce site** (distribution via AMO, mises à jour automatiques).
3. Charger `dist/evassistant-firefox.zip`.
4. Renseigner la fiche :
   - **Nom** : Evassistant
   - **Résumé / Description** : voir `store-listing.txt`
   - **Catégorie** : Productivité
   - **Langue** : Français
5. Ajouter l'icône `icons/icon128.png` et au moins une capture d'écran.
6. Indiquer l'URL de `privacy-policy.html` hébergée publiquement.
7. Confirmer la déclaration de collecte de données : **aucune donnée
   collectée** (correspond à `data_collection_permissions: { required: ["none"] }`
   dans `manifest.firefox.json`).
8. Soumettre pour revue (la revue AMO inclut une vérification automatisée
   et parfois manuelle du code source, qui est en clair — pas d'obfuscation).

### Vérifications avant soumission

- [ ] Module chargé temporairement via `about:debugging#/runtime/this-firefox` et testé sur `app.eva.gg`.
- [ ] `browser_specific_settings.gecko.id` présent et stable dans `manifest.firefox.json`.
- [ ] Version identique (ou supérieure) à celle publiée sur Chrome.
- [ ] Aucune erreur dans la console du navigateur (`Ctrl+Maj+J` ou outils de développement de la popup).
