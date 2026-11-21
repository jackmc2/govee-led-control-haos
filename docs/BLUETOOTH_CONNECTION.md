# H70B3 — Bluetooth, transferts d'images et GIF natifs

**Statut : intégré à la version stable, testé sur un Govee H70B3 réel.**

Le rideau **Govee H70B3 Curtain Lights 2** comporte une matrice de **20 × 26 LED (520 pixels)**. Govee LED Control — HAOS communique directement avec lui en Bluetooth (BLE) pour transférer des images et des GIF. Le **contrôle LAN**, à activer dans Govee Home, sert séparément aux commandes Marche / Arrêt du LED Player.

## Connexion Bluetooth requise

Pour envoyer une image ou un GIF, Home Assistant doit pouvoir établir une **connexion Bluetooth active (GATT)** au H70B3 via :

- un **adaptateur Bluetooth local compatible**, accessible par Home Assistant et à portée du rideau ; **ou**
- un **proxy Bluetooth ESPHome** connectable, situé à portée du H70B3.

Configuration ESPHome indicative pour un ESP32 compatible (à intégrer dans sa configuration complète) :

```yaml
esp32_ble_tracker:

bluetooth_proxy:
  active: true
```

Le proxy n'est **pas obligatoire** si Home Assistant dispose déjà d'un adaptateur Bluetooth connectable fonctionnel. Le réseau Wi-Fi seul ne suffit pas pour envoyer des images et GIF. La **MAC Bluetooth** utilisée dans l'assistant H70B3 n'est pas l'adresse IP LAN.

## Fonctionnement validé sur le matériel

| Opération | Connexion Bluetooth | Comportement observé |
| --- | --- | --- |
| Envoi d'une **image fixe** 20 × 26 | Connexion BLE authentifiée, transfert A4/58 et activation | Image affichée ; BLE libéré après transfert |
| Envoi d'un **GIF natif** depuis LED Studio ou LED Player | Un seul transfert BLE via `upload_native_gif` | **Lecture autonome sur le H70B3**, même après fermeture de la page |
| Changement d'effet dans **Govee Home** après un GIF | Aucune nouvelle transmission imposée par HAOS | Le nouvel effet choisi dans l'application reste actif |
| Prévisualisation GIF dans les cartes | **Aucune transmission BLE** | Animation jouée uniquement dans le navigateur |
| Marche / Arrêt depuis LED Player | **Aucune transmission BLE** | Commande LAN, avec « LAN Control » activé dans Govee Home |

**Validation matérielle effectuée le 21 novembre 2026** : envoi d'un GIF natif, lecture maintenue après fermeture de LED Studio et reprise du contrôle depuis Govee Home. Cela confirme le fonctionnement sur **l'appareil testé**, sans garantir tous les firmwares ni tous les GIF possibles.

### Pourquoi le Bluetooth ne reste pas occupé

Le transfert d'image ou de GIF s'effectue de manière ponctuelle. L'intégration authentifie la connexion BLE, envoie le contenu, attend les réponses du rideau puis libère la connexion. Elle ne rediffuse pas continuellement les images d'un GIF natif.

Le mode historique de diffusion **image par image** peut maintenir temporairement une connexion BLE lorsqu'il utilise `hold_ble: true`. Il est distinct de l'envoi de GIF natif et peut empêcher Govee Home de prendre la main pendant la diffusion.

## Services Home Assistant

### Image fixe

`govee_led_control.set_frame` : envoie une trame de **520 couleurs**. Le paramètre `hold_ble: false` (valeur par défaut) libère le Bluetooth après l'envoi.

### GIF natif autonome

`govee_led_control.upload_native_gif` : reçoit le contenu GIF 20 × 26 au format Base64 et le transmet en **une seule opération Bluetooth**. LED Studio et LED Player utilisent ce service pour les GIF natifs. La lecture se poursuit directement sur le rideau.

### Libérer explicitement une connexion BLE

```yaml
action: govee_led_control.release_bluetooth
data:
  config_entry_id: "ID_DE_L_ENTREE_H70B3"
```

Cette commande est destinée notamment à interrompre la possession BLE d'un ancien mode de diffusion. Il n'est normalement pas nécessaire de l'utiliser après un transfert natif.

## Diagnostic de découverte Bluetooth

L'assistant de configuration **Ajouter un appareil** propose une option **Actualiser** et s'appuie sur les annonces Bluetooth connues de Home Assistant.

- **Un H70B3 est déjà configuré** : il n'est **pas reproposé** comme nouvel appareil. Cela ne signifie pas qu'il est hors de portée.
- **Aucun scanner connectable** : vérifier l'adaptateur Bluetooth ou le proxy ESPHome actif (`bluetooth_proxy.active: true`).
- **Des scanners sont présents, mais aucune annonce H70B3** : vérifier la portée Bluetooth, le fonctionnement du proxy et l'état du rideau.
- **H70B3 visible, mais sans connexion possible** : vérifier que l'adaptateur ou le proxy autorise bien les **connexions BLE actives**.
- **Découverte indisponible** : l'ajout manuel par adresse **MAC Bluetooth** reste possible, sans garantir la connectivité si le rideau est hors de portée.

Le bouton **Actualiser** relit les annonces déjà remontées à Home Assistant ; il ne déclenche pas nécessairement un nouveau balayage radio.

Pour aller plus loin : [ESPHome Bluetooth Proxy](https://esphome.io/components/bluetooth_proxy/) et [détails du transfert GIF natif](NATIVE_GIF_EXPERIMENT.md).

## Portée de la validation

Les images fixes et les GIF natifs ont été validés sur le **H70B3 testé**. Les tests automatisés couvrent également les encodeurs et les appels de service, mais ne remplacent pas les essais physiques pour chaque firmware ou configuration de proxy.

Le support du modèle H6069 est conservé séparément dans l'intégration ; il **n'utilise pas le protocole GIF Bluetooth H70B3**.
