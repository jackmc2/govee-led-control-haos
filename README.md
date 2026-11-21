# Govee LED Control — HAOS

Intégration Home Assistant pour les éclairages Govee, avec priorité au rideau **H70B3 Curtain Lights 2** : matrice **20 × 26, soit 520 LED**.

**Dépôt de référence :** [jackmc2/govee-led-control-haos](https://github.com/jackmc2/govee-led-control-haos).  
**Branche stable :** `main`.  
**Version de l'intégration :** 0.5.6.

## Fonctionnalités

| Fonction | État | Mode |
| --- | --- | --- |
| Création et modification d'images 20 × 26 | Opérationnel | LED Studio |
| Import PNG, JPEG, WebP, BMP et GIF | Implémenté | Éditeur commun |
| Édition GIF image par image | Implémenté | Chronologie et dessin des pixels |
| Galerie enregistrée dans Home Assistant | Opérationnel | LED Studio + LED Player |
| Envoi d'une image fixe H70B3 | Validé sur matériel | Transfert BLE ponctuel |
| Envoi d'un GIF H70B3 | **Validé sur matériel** | Transfert GIF natif, lecture autonome |
| Lecture du GIF après fermeture de la page | **Validé sur matériel** | Pas de boucle de streaming HAOS |
| Changement d'effet depuis Govee Home | **Validé sur matériel** | Aucun retour imposé au GIF |
| Marche/arrêt H70B3 direct par le LAN | **Validé sur matériel** | Commandes UDP 4003 |
| Modules H6069 | Compatibilité maintenue | Backend dédié ; pas d'onglet H6069 dans LED Studio |

Les commandes usuelles en LAN ne nécessitent pas de connexion au cloud ni d'intégration Govee supplémentaire. Le Bluetooth est utilisé seulement pour les transferts d'images et d'animations nécessitant le protocole BLE.

## Deux cartes Home Assistant

### LED Studio

```yaml
type: custom:govee-led-studio
h70b3_transport_entity: sensor.h70b3_transport
```

L'éditeur permet de créer et d'importer une image ou un GIF, de modifier les pixels de la matrice, de sélectionner les images d'un GIF et de définir leur durée, puis d'enregistrer le résultat dans la galerie de Home Assistant.

La galerie est triée par ordre alphabétique, avec de véritables aperçus d'images et de GIF.

### LED Player

```yaml
type: custom:govee-led-player
title: LED Player
```

Le lecteur propose un aperçu agrandi, un bouton unique **« Envoyer sur le rideau »** pour les images ou GIF, une galerie à deux colonnes située sous le prévisualisateur, et un bouton Marche/Arrêt direct LAN.

La ligne des filtres Tout / Images / GIF contient également le bouton **Actualiser**, à droite.

Si le rideau n'est pas découvert automatiquement sur le LAN, la configuration peut préciser l'IP locale :

```yaml
type: custom:govee-led-player
title: LED Player
lan_ip: 192.168.1.50
```

Cette IP est un exemple de configuration locale : elle doit être adaptée au réseau utilisé.

## Installation depuis le Marketplace

L'intégration est **préparée pour une publication** dans le Marketplace natif de Home Assistant 2026.11 et versions ultérieures. **Tant que le dépôt reste privé, cette procédure n'est pas encore utilisable.**

Une fois le dépôt public et la version 0.5.6 publiée :

<!-- ha-marketplace:exclude-start -->

1. Ouvrir **Paramètres → Marketplace → Ajouter depuis un lien**.
2. Renseigner `https://github.com/jackmc2/govee-led-control-haos` et choisir **Intégration** si le type n'est pas reconnu.
3. Installer la version proposée, redémarrer Home Assistant, puis configurer le H70B3 dans **Paramètres → Appareils et services**.
4. Ajouter les cartes `custom:govee-led-studio` et `custom:govee-led-player` depuis le tableau de bord.

<!-- ha-marketplace:exclude-end -->

**LED Studio et LED Player sont inclus dans le dépôt de l'intégration** : aucun autre téléchargement ou dépôt Marketplace n'est nécessaire.


## Installation manuelle sur Home Assistant OS

1. Récupérer le dossier `custom_components/govee_led_control/` depuis la version/branche choisie.
2. Le copier vers `/config/custom_components/govee_led_control/`.
3. Redémarrer Home Assistant après une première installation ou une modification des fichiers Python.
4. Ajouter les cartes personnalisées dans le dashboard.
5. Recharger le navigateur avec `Ctrl + F5`.

Pour une modification ne concernant **que le frontend**, remplacer le fichier `.js` concerné et effectuer `Ctrl + F5` ; le redémarrage Home Assistant n'est pas requis.

## Architecture

```text
Home Assistant OS
 ├─ LED Studio (édition et sauvegarde)
 ├─ LED Player (prévisualisation et lecture)
 ├─ Galerie Home Assistant
 └─ Intégration govee_led_control
     ├─ H70B3 BLE : images et GIF natifs
     ├─ H70B3 LAN : marche/arrêt et état
     └─ Adaptateurs H6069 : compatibilité
```

Code principal :

- `frontend/govee-led-studio.js` et `frontend/govee-led-player.js` : les deux cartes.
- `gallery.py`, `gallery_data.py` : stockage des créations.
- `h70b3_ble.py`, `h70b3_protocol.py` et `h70b3_controller.py` : transferts BLE authentifiés.
- `h70b3_lan_power.py` : découverte, lecture d'état et marche/arrêt directs.
- `__init__.py` : services et commandes WebSocket HAOS.

## Vérifications

```bash
python -m compileall -q custom_components/govee_led_control
python -m unittest discover -s tests -v
node --check custom_components/govee_led_control/frontend/govee-led-studio.js
node --check custom_components/govee_led_control/frontend/govee-led-player.js
node tests/test_studio_editor.mjs
node tests/test_led_player.mjs
```

Les workflows de validation sont dans `.github/workflows/`. Les tests automatisés ne remplacent pas une vérification sur l'appareil réel.

## Documentation

- [docs/LED_PLAYER.md](docs/LED_PLAYER.md) — galerie et commande LAN.
- [docs/NATIVE_GIF_EXPERIMENT.md](docs/NATIVE_GIF_EXPERIMENT.md) — transfert GIF natif.

## Licence et responsabilité

Projet non officiel, non affilié à Govee ou Home Assistant. Les droits et notices de copyright applicables sont définis dans le fichier [LICENSE](LICENSE) (MIT).

Ne jamais publier les jetons GitHub, secrets, comptes, clés Bluetooth, adresses privées ou traces réseau contenant des données sensibles.
