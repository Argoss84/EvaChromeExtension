# Documentation technique - Extension Evassistant (Chrome & Firefox)

## Objectif

Extension de navigateur (Manifest V3), compatible **Chrome** et **Firefox**,
qui s'ouvre depuis la popup de la barre d'outils lorsqu'un onglet EVA
(`app.eva.gg` ou `www.eva.gg`) est actif, afin d'afficher :

-   Les participants des sessions à venir.
-   Les participants des 10 dernières parties de l'historique.
-   Les favoris de réservation.

## Compatibilité multi-navigateurs

Le code source est unique pour Chrome et Firefox. La compatibilité est
assurée par :

-   L'usage exclusif de l'espace de noms **`browser.*`** (promesses),
    au lieu de `chrome.*` (callbacks).
-   Le polyfill officiel de Mozilla **[`browser-polyfill.js`](https://github.com/mozilla/webextension-polyfill)**
    (vendorisé dans le dépôt), qui expose `browser.*` sur Chrome. Sur
    Firefox, ce polyfill ne fait rien (`browser` existe déjà nativement).
-   Deux manifests distincts :
    -   `manifest.json` : Chrome (Chrome Web Store).
    -   `manifest.firefox.json` : Firefox (AMO), avec la clé
        `browser_specific_settings` requise par Firefox.

Le polyfill doit être chargé :

-   Dans `popup.html`, avant `content.js` (contexte popup).
-   Dans l'onglet EVA, avant `page-bridge.js`, via
    `browser.scripting.executeScript({ files: ["browser-polyfill.js", "page-bridge.js"] })`.

## Structure

``` text
manifest.json            (Chrome)
manifest.firefox.json    (Firefox)
browser-polyfill.js      (polyfill Mozilla, vendorisé)
popup.html
content.js
page-bridge.js
style.css
icons/
scripts/
  package-extension.ps1          (package Chrome -> dist/evassistant.zip)
  package-extension-firefox.ps1  (package Firefox -> dist/evassistant-firefox.zip)
```

## Manifest

-   `manifest_version: 3`
-   Pas de `content_scripts` déclaré : le code s'exécute depuis la popup
    (`popup.html` -> `content.js`) et injecte dynamiquement
    `page-bridge.js` dans l'onglet EVA actif via `browser.scripting.executeScript`.
-   `permissions`
    -   `activeTab` : accès temporaire à l'onglet EVA actif lors de
        l'ouverture de la popup.
    -   `scripting` : injection de `page-bridge.js` (+ polyfill) dans
        l'onglet EVA.
-   `manifest.firefox.json` ajoute en plus :
    -   `browser_specific_settings.gecko.id` : identifiant requis pour
        la signature AMO.
    -   `browser_specific_settings.gecko.strict_min_version` : `"109.0"`
        (première version Firefox supportant `action`/MV3).
    -   `browser_specific_settings.gecko.data_collection_permissions` :
        `{ "required": ["none"] }` (obligatoire depuis le 3 novembre 2025
        pour toute nouvelle soumission AMO).

## Authentification

L'API GraphQL nécessite un JWT dans le header :

``` http
Authorization: Bearer <accessToken>
```

L'access token est obtenu automatiquement grâce à la mutation GraphQL :

``` graphql
mutation refreshToken {
  refreshToken {
    accessToken
  }
}
```

Requête :

-   endpoint : `https://api.eva.gg/graphql`
-   `credentials: "include"`
-   header :
    -   `eva-client-app-name: spa-app`
    -   `Content-Type: application/json`

Le cookie `refresh_token` est automatiquement envoyé par le navigateur.

En cas d'erreur `UNAUTHENTICATED`, le token est régénéré puis la requête
est rejouée.

## Endpoint GraphQL

### Réservations

Operation :

`getBookingOrderList`

Variables :

``` json
{
  "page": {
    "page": 1,
    "limit": 50
  },
  "filters": {
    "bookingPassed": false
  }
}
```

Historique :

``` json
{
  "filters": {
    "bookingPassed": true
  }
}
```

Champs utilisés :

-   booking.id
-   booking.orderId
-   booking.bookingGroupUnitId
-   booking.terrainId
-   booking.playerCount
-   booking.seatCount
-   booking.slot.id
-   booking.slot.localDatetime
-   booking.slot.startTime
-   booking.slot.endTime
-   booking.game.name
-   booking.location.name

### Participants (sessions à venir)

Operation :

`listParticipants`

Variables :

``` json
{
  "slotId": "...",
  "terrainId": 156
}
```

Champs :

-   user.displayName
-   experience.level
-   subscriptionPlan
-   isAnonymous

### Participants (historique)

Operation :

`getBookingGroupUnitById`

Variables :

``` json
{
  "id": "<bookingGroupUnitId>"
}
```

Champs :

-   participants.username.displayName
-   participants.username.fullName
-   participants.username.username
-   participants.level
-   participants.paidSeatCount

## Algorithme

### Sessions à venir

1.  refreshToken
2.  getBookingOrderList(bookingPassed=false)
3.  trier par `slot.localDatetime`
4.  pour chaque réservation :
    -   listParticipants(slotId, terrainId)
5.  affichage

### Historique

1.  pagination complète sur getBookingOrderList(bookingPassed=true)
2.  fusion de toutes les pages
3.  tri décroissant sur `slot.localDatetime`
4.  conserver les 10 plus récentes
5.  pour chaque réservation :
    -   getBookingGroupUnitById(bookingGroupUnitId)
6.  affichage

## UI

Panneau flottant injecté dans la page.

Deux onglets :

-   À venir
-   Historique

Bouton :

-   Rafraîchir

## Fonctions principales

-   refreshAccessToken()
-   graphql()
-   graphqlRequest()
-   loadUpcomingParticipants()
-   loadHistoryParticipants()
-   loadAllHistoryBookings()
-   extractBookings()
-   renderUpcomingSessions()
-   renderHistorySessions()

## Déploiement

### Chrome / Edge

Chargement local :

1.  `chrome://extensions`
2.  Activer le mode développeur
3.  Charger l'extension non empaquetée (sélectionner le dossier racine,
    qui contient `manifest.json`)
4.  Recharger après chaque modification.

Packaging pour publication :

``` powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
```

### Firefox

Chargement temporaire (débogage) :

1.  `about:debugging#/runtime/this-firefox`
2.  **Charger un module complémentaire temporaire**
3.  Sélectionner `manifest.firefox.json` (renommer temporairement en
    `manifest.json` dans un dossier de test, ou utiliser le zip généré
    ci-dessous et l'extraire).

Packaging pour publication (AMO) :

``` powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-extension-firefox.ps1
```

Ce script copie `manifest.firefox.json` en tant que `manifest.json`
dans le zip généré (`dist/evassistant-firefox.zip`), à soumettre sur
[addons.mozilla.org/developers](https://addons.mozilla.org/developers/).

> Remarque : le champ `browser_specific_settings.gecko.id` dans
> `manifest.firefox.json` (`evassistant@eva-extension.app`) peut être
> personnalisé, mais doit rester stable entre les versions publiées
> (il identifie l'extension sur AMO).

## Évolutions possibles

-   Rafraîchissement automatique.
-   Statistiques par joueur.
-   Niveau moyen des parties.
-   Recherche de joueur.
-   Notifications lorsqu'un participant rejoint une session.
-   Intégration native dans l'interface EVA plutôt qu'un panneau
    flottant.
