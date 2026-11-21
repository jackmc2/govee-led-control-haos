# LED Player — deuxième carte Home Assistant

**Depuis 0.5.4, le dépôt fournit deux cartes indépendantes :**

- **LED Studio** \`custom:govee-led-studio\` : création, conversion et enregistrement d'images et GIF.
- **LED Player** \`custom:govee-led-player\` : lecture des créations déjà enregistrées dans la même galerie Home Assistant.

## Installation sur HAOS

Déployer **le dossier complet** \`custom_components/govee_led_control\` de la branche \`feature/ble-connection-release\` (version 0.5.4) et **redémarrer Home Assistant**, afin d'enregistrer la nouvelle ressource frontend.

Dans un tableau de bord, ajouter une carte manuelle YAML :

\`\`\`yaml
type: custom:govee-led-player
title: LED Player
\`\`\`

La carte détecte les capteurs transport H70B3 et H6069 via l'intégration. Pour un ID modifié, les clés facultatives \`h70b3_transport_entity\` et \`h6069_transport_entity\` peuvent être indiquées (cf. \`LED_PLAYER_CARD.yaml\`).

## Fonctionnement

- Charge **directement** la galerie partagée via \`govee_led_control/gallery/list\` (WebSocket).
- Affiche une liste avec **miniatures réelles**, filtres Tout / Images / GIF, aperçu agrandi. L'aperçu GIF est animé **localement sur l'écran uniquement**, sans aucune commande BLE.
- **GIF H70B3** : reconstruit le GIF natif 20×26 depuis les images sauvegardées et lance \`govee_led_control.upload_native_gif\` **une seule fois**. Le H70B3 continue l'animation de manière autonome et la connexion BLE est libérée après transfert.
- **Image H70B3** : utilise le service existant \`govee_led_control.set_frame\` (image 520 pixels), avec luminosité sauvegardée et libération Bluetooth après envoi.
- **Image H6069** : utilise le même \`set_frame\` et le transport LAN existant, sans modifier les panneaux ni le protocole.
- Bouton **Actualiser** pour récupérer une nouvelle création enregistrée dans LED Studio sans recharger la page.
- Aucun nouvel état ni espace de stockage dupliqué ; **pas de modification de la galerie enregistrée**, pas de suppression depuis LED Player.
- L'envoi est déclenché uniquement sur clic : charger la carte ou parcourir les miniatures **n'envoie aucune commande à l'éclairage**.

## Tests

- Syntaxe JS des deux cartes.
- Appel H70B3 image statique : \`set_frame\`.
- Appel H70B3 GIF : **un** \`upload_native_gif\`, format GIF89a 20×26.
- Appel image H6069 : \`set_frame\` dirigé vers l'entrée configurée.
- Tests Python et Hassfest sur GitHub Actions.

## Note

Le protocole GIF natif autonome est déjà **validé physiquement sur un H70B3** depuis LED Studio. La nouvelle carte LED Player reprend ce **même service**, mais reste à valider dans HAOS sur l'appareil réel après installation.

## Marche / arrêt du H70B3 directement en LAN (0.5.6)

Le bouton **⏻ Allumer / ⏻ Éteindre**, à côté de **Actualiser**, commande le H70B3 **directement par le réseau local** :
- Auto-détection du bon appareil par réponse de scan multicast Govee (UDP 4001/4002, SKU H70B3 et adresse MAC BLE correspondante).
- Lecture de l'état réel avec \`devStatus\` (\`onOff\`) sur UDP 4003 → réponse sur UDP 4002.
- Envoi marche/arrêt par \`{"msg":{"cmd":"turn","data":{"value":1}}}\` ou \`0\` sur UDP 4003.
- **Aucun recours aux entités \`light.govee\` / \`switch.govee\` ni au cloud**, ni au streaming de pixels, ni à la connexion BLE.
- L'état du bouton est périodiquement actualisé par LED Player. En l'absence de confirmation d'état il reste désactivé : on ne devine pas si l'appareil est allumé.
- Si le multicast HAOS ne découvre pas le rideau, ajouter son IP LAN dans la configuration de la carte :

\`\`\`yaml
type: custom:govee-led-player
title: LED Player
lan_ip: 192.168.1.50
\`\`\`

\`lan_ip\` est facultatif et correspond à l'adresse Govee du réseau local, **pas à une entité Home Assistant**. Une réservation DHCP de cette adresse dans la Freebox est conseillée pour éviter les changements d'IP.

**Installation de cette évolution :** le dossier \`custom_components/govee_led_control\` **complet** version 0.5.6 est nécessaire, suivi d'un **redémarrage de Home Assistant**, car deux nouvelles commandes WebSocket côté serveur sont enregistrées. Remplacer uniquement le JS ne suffit plus. Faire ensuite Ctrl+F5.

**Validation :** la présence du protocole \`turn\` dans l'API LAN Govee est documentée, et les commandes LAN du H70B3 étaient déjà joignables séparément. Ce bouton et son accès HAOS restent à **valider sur le rideau réel**, particulièrement la reprise d'un GIF après réallumage.

## Luminosité mémorisée (0.5.7)

Le **curseur ☀ Luminosité du rideau (1 à 100 %)** est situé sous l'aperçu.
Sa valeur est enregistrée dans le stockage Home Assistant
(`/config/.storage/govee_led_control.gallery`) et conservée après
actualisation, changement de navigateur et redémarrage de Home Assistant.

- Pour une image fixe, la valeur est transmise lors de **Envoyer sur le rideau**.
- Pour un GIF, la palette des 256 couleurs du GIF natif est ajustée **avant**
  son unique transfert BLE, sans boucle de diffusion ni perte de lecture autonome.
- Modifier le curseur actualise l'aperçu **sans envoyer de commande au rideau**.
  Pour appliquer le nouveau niveau à une animation déjà en cours, il faut
  renvoyer la création depuis le Player.
- Le réglage n'altère pas les créations enregistrées dans la galerie.

## Classement de la bibliothèque (0.5.9)

Dans **LED Player**, les créations sont affichées par **ordre alphabétique de leur nom (A → Z)**, indépendamment de leur date d'ajout ou de modification. Le tri tient compte des accents, ignore les différences majuscules/minuscules et classe naturellement les numéros (par exemple, « Noël 2 » avant « Noël 10 »).

Ce classement s'applique à la galerie complète et aux filtres **Tout / Images / GIF**, y compris après **Actualiser**. Il ne modifie ni les créations ni leur ordre de stockage dans Home Assistant.
