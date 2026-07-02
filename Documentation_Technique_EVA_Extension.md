# Documentation technique - Extension Chrome EVA Participants

## Objectif

Extension Chrome (Manifest V3) injectée sur
`https://app.eva.gg/fr-FR/account/bookings` afin d'afficher :

-   Les participants des sessions à venir.
-   Les participants des 10 dernières parties de l'historique.

## Structure

``` text
manifest.json
content.js
style.css
```

## Manifest

-   `manifest_version: 3`
-   `content_scripts` injecté sur :
    -   `https://app.eva.gg/fr-FR/account/bookings*`
-   `host_permissions`
    -   `https://app.eva.gg/*`
    -   `https://api.eva.gg/*`

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

Chargement local :

1.  `chrome://extensions`
2.  Activer le mode développeur
3.  Charger l'extension non empaquetée
4.  Recharger après chaque modification.

## Évolutions possibles

-   Rafraîchissement automatique.
-   Statistiques par joueur.
-   Niveau moyen des parties.
-   Recherche de joueur.
-   Notifications lorsqu'un participant rejoint une session.
-   Intégration native dans l'interface EVA plutôt qu'un panneau
    flottant.
