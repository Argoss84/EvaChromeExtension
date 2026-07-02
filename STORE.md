# Publication Chrome Web Store

## Prérequis

- Un compte [Chrome Web Store Developer](https://chrome.google.com/webstore/devconsole) (frais unique de 5 USD).
- Une URL publique pour la politique de confidentialité (héberger `privacy-policy.html`, par exemple via GitHub Pages).

## Fichiers inclus dans le package

Le zip de publication doit contenir uniquement :

- `manifest.json`
- `popup.html`
- `content.js`
- `style.css`
- `page-bridge.js`
- `icons/icon16.png`
- `icons/icon32.png`
- `icons/icon48.png`
- `icons/icon128.png`

Ne pas inclure : `.git`, `dist/`, `scripts/`, `EvaEvolved.png`, documentation interne.

## Créer le zip

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
```

Le fichier `dist/evassistant.zip` sera généré.

## Étapes de publication

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
   - `storage` : stockage local des favoris.
   - `tabs` : communication avec l'onglet EVA actif.
   - `host_permissions` : accès aux pages et API EVA uniquement.
8. Soumettre pour examen.

## Vérifications avant soumission

- [ ] Extension rechargée et testée sur `app.eva.gg` avec compte connecté.
- [ ] Onglet Favoris : création, ouverture, suppression OK.
- [ ] Onglets À venir / Historique : chargement OK.
- [ ] Aucune erreur dans la console de la popup.
- [ ] Version incrémentée dans `manifest.json`.
