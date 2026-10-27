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

Le script génère `dist/evassistant.zip` ainsi qu'un dossier
`dist/store-<version>/` contenant :

- `evassistant-<version>.zip` : archive à téléverser sur le store ;
- `store-listing.txt` : description de l'extension ;
- `privacy-policy.html` : politique de confidentialité à publier ;
- `icon128.png` : icône de l'extension ;
- `guide-publication.md` et `notes-version.md` : instructions et changements ;
- `SHA256SUMS.txt` : empreinte SHA-256 de l'archive.

Le dossier `dist/` est généré localement et exclu de Git.

## Étapes de publication

1. Ouvrir le [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Ouvrir la fiche de l'extension existante et téléverser le nouveau package
   `evassistant-<version>.zip` depuis le dossier généré. Pour une première
   publication, choisir **Nouvel élément**.
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
   - `scripting` : relayer les appels API via la session EVA connectée et
     utiliser sa vérification de sécurité pour charger les participants.
8. Soumettre pour examen.

## Vérifications avant soumission

- [ ] Extension rechargée et testée sur `app.eva.gg` avec compte connecté.
- [ ] Evassistant ouvert depuis un onglet EVA actif (obligatoire).
- [ ] Onglet Favoris : création, ouverture, suppression OK.
- [ ] Onglets À venir / Historique : chargement OK.
- [ ] Aucune erreur dans la console de la popup.
- [ ] Version incrémentée dans `manifest.json`.
- [ ] Politique de confidentialité publiée à une URL accessible et mise à jour sur la fiche store.
- [ ] Au moins une capture d'écran de l'extension ajoutée à la fiche store.
