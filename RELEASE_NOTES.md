# Evassistant 1.4.4

27 octobre 2026

## Changements

- Correction de la requête des participants dans « À venir » : transmission du `gameId` de chaque réservation.
- Utilisation de la vérification de sécurité native EVA requise pour consulter les participants.
- Distinction entre une déconnexion et un refus d'accès ou un échec de vérification.
- Conservation des réservations à l'écran lorsqu'une liste de participants ne peut pas être chargée.
- Suppression du bouton de réduction devenu obsolète.
- Mise à jour de la politique de confidentialité pour décrire la vérification Google reCAPTCHA.
- Préparation d'un dossier de publication versionné avec une archive utilisant des chemins compatibles avec le store.

## Validation effectuée

- 12 tests réussis avec API EVA et reCAPTCHA simulés (`node --test scripts/content.test.cjs`).
- Syntaxe JavaScript vérifiée pour `content.js` et `page-bridge.js`.
- Contenu de l'archive vérifié et comparé aux fichiers sources avant livraison.

## Avant soumission au store

- Recharger l'extension et l'onglet EVA, puis vérifier les trois onglets avec une session connectée. La vérification reCAPTCHA réelle n'a pas été exécutée lors des tests automatisés.
- Publier la politique de confidentialité actualisée et renseigner son URL dans la console du store.
- Ajouter au moins une capture d'écran de l'extension sur la fiche store, si aucune n'y figure déjà.
