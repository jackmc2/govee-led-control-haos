# Govee LED Control — HAOS

<p align="center">
  <a href="https://github.com/jackmc2/govee-led-control-haos/releases/latest"><img alt="Dernière version" src="https://img.shields.io/github/v/release/jackmc2/govee-led-control-haos?style=flat-square&label=version&color=7c63ed"></a>
  <a href="https://github.com/jackmc2/govee-led-control-haos/actions/workflows/validate.yml"><img alt="Tests et validation" src="https://github.com/jackmc2/govee-led-control-haos/actions/workflows/validate.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Licence MIT" src="https://img.shields.io/badge/licence-MIT-3fbfbc?style=flat-square"></a>
  <a href="https://www.home-assistant.io/"><img alt="Home Assistant" src="https://img.shields.io/badge/Home%20Assistant-2026.11%2B-41bdf5?style=flat-square"></a>
</p>

<p align="center">
  <strong>Un atelier de création et une galerie pour votre rideau LED Govee H70B3.</strong><br>
  Créez vos images, animez vos GIF, puis envoyez-les sur le rideau depuis Home Assistant — en local.
</p>

<p align="center">
  <a href="#-prérequis--lan-et-bluetooth">Prérequis LAN / Bluetooth</a> ·
  <a href="#-installation">Installation</a> ·
  <a href="#-led-studio">LED Studio</a> ·
  <a href="#-led-player">LED Player</a> ·
  <a href="#-configuration-des-cartes">Cartes Lovelace</a> ·
  <a href="#-documentation">Documentation</a>
</p>

## 📸 Aperçu réel dans Home Assistant

<p align="center">
  <img src="docs/assets/govee-dashboard.png" width="1000" alt="Capture réelle du tableau de bord Home Assistant avec LED Studio et LED Player côte à côte, galerie de GIF et aperçu d’un sapin de Noël">
</p>

*Capture de l'interface réelle sous Home Assistant : LED Studio à gauche, LED Player à droite. Le GIF « Sapin Noël » est sélectionné dans le lecteur. L'éditeur de pixels s'ouvre uniquement lorsqu'une création est importée, créée ou modifiée.*

---

## ✨ En bref

| **20 × 26** | **520 LED** | **Bluetooth + LAN** | **GIF autonomes** |
| :---: | :---: | :---: | :---: |
| Matrice du H70B3 | Contrôle pixel par pixel | Transfert BLE, marche/arrêt LAN | Le rideau continue de jouer sans streaming HA |

- 🎨 **Créer** une image ou un GIF directement depuis le tableau de bord Home Assistant.
- 🖼️ **Importer** des fichiers PNG, JPEG, WebP, BMP ou GIF et les adapter à la matrice.
- 🧩 **Modifier** les pixels, les couleurs et les images d'une animation dans un éditeur commun.
- 📁 **Enregistrer** et retrouver les créations dans une galerie persistante Home Assistant.
- ▶️ **Prévisualiser** les GIF dans le navigateur avant de les envoyer.
- 📡 **Transférer** une image ou un GIF natif en Bluetooth, puis libérer la connexion.
- ⏻ **Allumer ou éteindre** le H70B3 directement en LAN, sans service cloud supplémentaire.

> **Matériel :** le H70B3 est le modèle principal, avec transferts d'images et de GIF validés sur l'appareil. Le code des panneaux **H6069** reste présent pour sa compatibilité LAN ; l'éditeur graphique illustré ici est dédié au H70B3.

## 🎨 LED Studio

<img src="docs/assets/led-studio.png" alt="Capture réelle de LED Studio : zone Importer ou créer et galerie avec GIF Cadeau et Sapin Noël" width="520">

**L'espace de création**, intégré à une carte Lovelace. La capture montre son état normal, éditeur refermé :

- La zone **Importer ou créer** permet de charger un PNG, JPEG, WebP ou GIF, ou de commencer une nouvelle image / animation.
- La **galerie** affiche les créations sur **deux colonnes** quand la largeur le permet, avec miniatures, **catégorie clairement identifiée**, bouton **Modifier** et suppression. Une seule colonne reste utilisée sur écran très étroit.
- Une **catégorie libre** peut être attribuée à chaque image ou GIF lors de son enregistrement (avec suggestions des catégories existantes). Les catégories se **créent, renomment et suppriment** aussi depuis la galerie. Renommer une catégorie actualise toutes ses créations ; la supprimer les passe dans **Non classé**, sans effacer les images ni GIF.
- En ouvrant une création, l'éditeur affiche la matrice **20 × 26**, les outils de dessin, la palette, la luminosité et les images du GIF.
- Le bouton **▶ Lire** prévisualise localement l'animation, sans transfert Bluetooth.

L'éditeur est **masqué au démarrage** : il apparaît uniquement après un import, une création ou un clic sur **Modifier** dans la galerie.

## ▶️ LED Player

<img src="docs/assets/led-player.png" alt="Capture réelle de LED Player : aperçu du GIF Sapin Noël, bouton Envoyer sur le rideau, commande Éteindre et galerie" width="520">

**La carte de lecture**, pensée pour un usage quotidien. La capture montre une animation **« Sapin Noël »** sélectionnée :

- Le bouton **⏻ Éteindre** en haut à droite reflète l'état de la guirlande et commande son alimentation via le LAN.
- Les filtres **Tout / Images / GIF** et **Actualiser** partagent la même ligne.
- L'aperçu central affiche la création sélectionnée, le nombre d'images et la luminosité, au-dessus du bouton **Envoyer sur le rideau**.
- La galerie est organisée en **deux colonnes sous la prévisualisation**, **triée par ordre alphabétique (A → Z)** et filtrable par **catégorie personnalisée** (Noël, Halloween, etc.) ainsi que par type Images / GIF.

Pour les GIF natifs H70B3, le fichier est transféré en une opération Bluetooth : **le rideau poursuit la lecture après fermeture de la carte ou du navigateur**. L'application Govee Home peut reprendre le contrôle et changer l'effet.

<sub>Captures réelles de l’interface Home Assistant. Les images et les GIF présentés sont des exemples de créations enregistrées dans la galerie.</sub>

## 🔧 Prérequis : LAN et Bluetooth

Pour piloter le **Govee H70B3**, Home Assistant utilise **deux connexions locales différentes**. Vérifiez leur configuration **avant** d'installer les cartes ou d'envoyer vos créations.

| Connexion | À quoi sert-elle ? | Configuration nécessaire |
| --- | --- | --- |
| **LAN / Wi-Fi** | Lire l'état du rideau et l'**allumer / l'éteindre** depuis LED Player | Activer **Contrôle LAN (LAN Control)** dans l'application **Govee Home**. Le H70B3 et Home Assistant doivent être joignables sur le réseau local. |
| **Bluetooth (BLE)** | Transférer une **image 20 × 26** ou un **GIF natif** sur le H70B3 | Disposer d'un **adaptateur Bluetooth connectable reconnu par Home Assistant** **ou** d'un **proxy Bluetooth ESPHome actif** à portée du rideau. |

### 1. Activer le contrôle LAN dans Govee Home

1. Ouvrez l'application mobile **Govee Home** et sélectionnez votre **H70B3**.
2. Ouvrez les **paramètres de l'appareil** (icône ⚙️) et activez l'option **Contrôle LAN / LAN Control** si elle est proposée.
3. Vérifiez que le rideau est connecté au **Wi-Fi local** et que Home Assistant peut communiquer avec lui. La découverte automatique utilise le trafic UDP local ; évitez de bloquer les échanges entre ces appareils.
4. Si LED Player n'arrive pas à trouver le rideau, renseignez son IP locale avec l'option `lan_ip` dans la [configuration de la carte](#led-player-1).

> Le **contrôle LAN n'est utilisé que pour les commandes locales du Player**, notamment Marche / Arrêt. **L'activer ne remplace pas le Bluetooth** nécessaire aux transferts d'images et de GIF.

### 2. Prévoir une connexion Bluetooth pour les images et GIF

Le H70B3 doit être accessible en **Bluetooth connectable (GATT)** depuis Home Assistant. Deux solutions sont possibles :

- **Adaptateur Bluetooth local** : un adaptateur compatible, exposé à Home Assistant et suffisamment proche du rideau.
- **Proxy Bluetooth ESPHome** : un ESP32 avec le composant Bluetooth Proxy, connecté au même Home Assistant, placé à portée du H70B3. C'est généralement plus pratique quand HAOS tourne sur un serveur éloigné du rideau.

Exemple de configuration minimale **ESPHome** sur un ESP32 compatible :

```yaml
esp32_ble_tracker:

bluetooth_proxy:
  active: true
```

Intégrez ensuite cet appareil ESPHome à Home Assistant, puis vérifiez que son scanner Bluetooth est opérationnel. Consultez la [documentation officielle ESPHome Bluetooth Proxy](https://esphome.io/components/bluetooth_proxy/) pour la configuration complète de l'ESP32.

> **Un proxy ESPHome n'est pas obligatoire** si Home Assistant dispose déjà d'un adaptateur Bluetooth connectable qui atteint le H70B3. À l'inverse, le Wi-Fi et le contrôle LAN seuls ne permettent **pas** d'envoyer les images ou les GIF.

**En résumé : LAN activé dans Govee Home pour Marche / Arrêt ; Bluetooth local ou proxy ESPHome actif pour les transferts 520 LED et GIF.**

## 🚀 Installation

### Home Assistant Marketplace (recommandé)

L'intégration est disponible depuis le **[dépôt public GitHub](https://github.com/jackmc2/govee-led-control-haos)** et sa [dernière release](https://github.com/jackmc2/govee-led-control-haos/releases/latest).

1. Dans **Home Assistant 2026.11 ou version ultérieure**, ouvrez **Paramètres → Marketplace → Ajouter depuis un lien**.
2. Collez l'adresse du dépôt :

   ```text
   https://github.com/jackmc2/govee-led-control-haos
   ```

3. Sélectionnez le type **Intégration**, installez la version proposée et **redémarrez Home Assistant**.
4. Dans **Paramètres → Appareils et services → Ajouter une intégration**, recherchez **Govee LED Control — HAOS** et configurez votre appareil si ce n'est pas déjà fait.
5. Ajoutez ensuite les cartes LED Studio et LED Player à votre tableau de bord.

**Les deux cartes frontend sont livrées dans l'intégration** : aucun dépôt de cartes supplémentaire n'est nécessaire.

> **Migration depuis un ancien fork :** si le Marketplace indique que le dossier `govee_led_control` appartient déjà à un autre dépôt, **n'installez pas par-dessus et ne supprimez pas votre appareil depuis Appareils et services**. Sauvegardez Home Assistant et vérifiez d'abord la propriété de l'installation dans Marketplace. La configuration de l'appareil et la galerie ne doivent pas être effacées.

### Installation manuelle

Copiez `custom_components/govee_led_control/` vers `/config/custom_components/govee_led_control/`, puis redémarrez Home Assistant. L'installation depuis le Marketplace est préférable pour recevoir les mises à jour.

## 🧱 Configuration des cartes

### LED Studio

```yaml
type: custom:govee-led-studio
h70b3_transport_entity: sensor.h70b3_transport
```

Adaptez l'identifiant de l'entité de transport à votre installation si nécessaire.

### LED Player

```yaml
type: custom:govee-led-player
title: LED Player
```

Si le H70B3 n'est pas découvert automatiquement sur votre réseau, vous pouvez préciser son **adresse IP locale** :

```yaml
type: custom:govee-led-player
title: LED Player
lan_ip: 192.168.1.50
```

`192.168.1.50` est une **adresse d'exemple**. Elle ne correspond pas à un appareil réel imposé par le projet.

Après une mise à jour des fichiers JavaScript, un rechargement forcé du navigateur (`Ctrl + F5`) peut être nécessaire.

## 🔌 Fonctionnement

```text
                 Home Assistant OS
                         │
               Govee LED Control
                  /           \
           LED Studio       LED Player
         Création/édition   Galerie/lecture
                  \           /
                   Galerie locale
                         │
                 ┌───────┴──────┐
                 │              │
             Bluetooth         LAN
          Images / GIF      Marche / arrêt
                 │              │
                 └───────┬──────┘
                         │
                 Govee H70B3
                   20 × 26 LED
```

Le H70B3 doit être accessible via un **adaptateur Bluetooth Home Assistant** ou un **proxy Bluetooth ESPHome** capable d'établir une connexion. La configuration manuelle accepte l'adresse **MAC Bluetooth**, différente de l'IP Wi-Fi.

Le transfert Bluetooth des images et des GIF est ponctuel ; la commande Marche / Arrêt utilise le réseau local. Les usages décrits ne nécessitent pas le cloud Govee.

## 🧪 Validation

Les [GitHub Actions](https://github.com/jackmc2/govee-led-control-haos/actions/workflows/validate.yml) exécutent les vérifications **HACS**, **Hassfest** et les tests de protocole et d'interface.

```bash
python -m unittest discover -s tests -v
node --check custom_components/govee_led_control/frontend/govee-led-studio.js
node --check custom_components/govee_led_control/frontend/govee-led-player.js
node tests/test_studio_editor.mjs
node tests/test_led_player.mjs
```

## 📚 Documentation

- [LED Player : commandes, galerie et contrôle LAN](docs/LED_PLAYER.md)
- [Connexion Bluetooth et diagnostic H70B3](docs/BLUETOOTH_CONNECTION.md)
- [Transfert GIF natif H70B3](docs/NATIVE_GIF_EXPERIMENT.md)
- [Entités et identifiants Home Assistant](docs/ENTITY_IDS.md)
- [Versions publiées](https://github.com/jackmc2/govee-led-control-haos/releases)

## 🤝 Licence

Projet communautaire **non officiel**, sans affiliation avec Govee ou Home Assistant. Distribué selon les termes de la [licence MIT](LICENSE), avec conservation des mentions de copyright applicables.
