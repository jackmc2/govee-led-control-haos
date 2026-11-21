# H70B3 — GIF natif autonome : protocole et validation

**Statut actuel : implémenté et validé sur un H70B3 réel le 21 novembre 2026.** Ce fichier conserve aussi les détails techniques issus de la phase expérimentale initiale (v0.5.3).

## Résultat validé

- **Envoi unique d'un GIF natif** au H70B3 à travers le service `govee_led_control.upload_native_gif`.
- **Lecture autonome du GIF sur le rideau**, sans diffusion image par image par Home Assistant.
- **Animation maintenue après fermeture** de LED Studio ou du navigateur.
- **Reprise du contrôle par Govee Home** : choisir un autre effet dans l'application ne déclenche aucun retour forcé au GIF.
- **Libération de la connexion Bluetooth** après l'envoi.

Ces comportements ont été **validés matériellement par l'utilisateur le 21/11/2026**. Ils concernent l'appareil testé : la compatibilité universelle avec tous les firmwares et tous les fichiers GIF n'a pas été établie.

## Fonctionnement dans les versions stables

LED Studio permet l'import, la création et la modification de GIF dans une matrice **20 × 26 (520 LED)**. LED Player permet de sélectionner une création de la galerie puis de cliquer sur **« Envoyer sur le rideau »**.

Un GIF est encodé en format natif puis transféré en **une opération Bluetooth**. Le rideau prend en charge sa lecture : aucun minuteur d'animation n'est nécessaire côté serveur ou navigateur. Les prévisualisations dans les cartes restent locales et n'envoient rien au rideau.

Le protocole impose notamment la dimension **20 × 26** et une limite de charge GIF native de **320 Kio**. Les fichiers importés peuvent être convertis et reconstruits par les cartes avant transfert ; les limites s'appliquent au contenu effectivement envoyé.

## Fondement du protocole

Les analyses de l'application Govee Home réalisées pendant le développement ont montré :

- `EffectH70b3Gif.getBytes()` produit un effet commençant par le marqueur **`0x5D`**, suivi des octets du GIF.
- `H70b3GifParse.makeBleMaterialGifController()` prépare le matériau GIF avant son envoi.
- L'enveloppe de transfert utilise le protocole **A4/58** déjà utilisé pour les images fixes.
- Le client `h70b3_ble.py` effectue l'authentification, le transfert, les acquittements, l'activation puis la déconnexion BLE.

Les doutes concernant la lecture autonome et la commande d'activation, présents dans les premières notes de la branche expérimentale, ont été **levés par les essais physiques**. Il reste possible que certains GIF ou firmwares rencontrent des limitations non encore caractérisées.

## Éléments du code

- `h70b3_protocol.py` : validation GIF, préfixe `0x5D`, construction des paquets `A4/58`.
- `h70b3_ble.py` : session BLE chiffrée, transfert natif et libération BLE.
- `h70b3_controller.py` : orchestration des opérations de transfert.
- `__init__.py` / `services.yaml` : service `govee_led_control.upload_native_gif`.
- `frontend/govee-led-studio.js` et `frontend/govee-led-player.js` : création, sélection, prévisualisation et envoi depuis Home Assistant.

## Historique de validation

| Étape | Résultat |
| --- | --- |
| Protocole identifié et première implémentation (v0.5.3) | Initialement expérimental |
| Transfert et affichage d'un GIF sur H70B3 | **Validé sur matériel** |
| Lecture après fermeture du navigateur | **Validée sur matériel** |
| Changement d'effet depuis Govee Home | **Validé sur matériel** |
| Publication dans l'intégration stable | **Effective** |

Voir le [README](../README.md) et la [documentation Bluetooth actuelle](BLUETOOTH_CONNECTION.md) pour les prérequis (adaptateur local ou proxy ESPHome actif).
