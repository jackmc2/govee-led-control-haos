# H70B3 — propriété de la connexion Bluetooth

**Statut : branche expérimentale ; tests unitaires automatisés, validation matérielle HAOS à effectuer.**

Cette évolution porte sur la Govee H70B3 (20 × 26 pixels) avec le proxy Bluetooth ESPHome existant. Elle ne remplace ni les commandes LAN/Matter standard ni l'application Govee Home.

## Fonctionnement

| Opération | Liaison Bluetooth | Effet sur Govee Home |
| --- | --- | --- |
| Dessin / image fixe LED Studio | Connexion, authentification, upload A4/58, activation 33/05, déconnexion dès les accusés de réception | Peut reprendre le contrôle après la déconnexion |
| Actions HAOS `set_frame`, `set_pixels`, `show_demo` | Même comportement ponctuel par défaut | Pas de connexion maintenue entre deux appels |
| GIF ancien mode, image par image dans le navigateur | `set_frame` avec `hold_ble: true` | Le téléphone peut rester bloqué **pendant** la lecture |
| Arrêt d'un GIF dans LED Studio | Action `release_bluetooth` | Libération demandée immédiatement |
| GIF natif avec lecture autonome dans la H70B3 | **Non implémenté**, protocole de transfert à documenter | Objectif ultérieur |

## Services

### Image fixe

Le service `govee_led_control.set_frame` accepte désormais `hold_ble: false` (valeur par défaut), avec exactement 520 couleurs.

### Streaming (rétrocompatibilité du navigateur)

`hold_ble: true` maintient temporairement la connexion pendant la succession d'images. Le mécanisme existant de déconnexion sur inactivité continue de s'appliquer et est configurable dans les options de l'intégration.

### Libération manuelle

```yaml
action: govee_led_control.release_bluetooth
data:
  config_entry_id: "<l'identifiant de ta configuration H70B3>"
```

N'utiliser cette action que lorsqu'aucun autre envoi n'est en cours ; elle attend la fin des transmissions déjà engagées.

## Diagnostic de découverte Bluetooth

Le parcours de configuration affiche une option **Actualiser** accompagnée d'un diagnostic de ce que voit réellement le gestionnaire Bluetooth de Home Assistant :

- **Aucun scanner connectable** : pas d'adaptateur BLE capable d'établir les connexions GATT nécessaires à la H70B3. Vérifier que l'ESPHome dispose de `esp32_ble_tracker:` et `bluetooth_proxy:\n  active: true` et qu'il est intégré à HAOS.
- **Scanner(s) mais aucune annonce** : vérifier que le proxy ESPHome est bien connecté, assez proche de la guirlande et que son mode de scan est **Actif** (et pas seulement `bluetooth_proxy.active`). Sur certaines versions de HAOS, le mode Auto a empêché les annonces BLE de remonter.
- **H70B3 visible sans lien connectable** : la guirlande est annoncée, mais il faut un adaptateur/proxy autorisant les connexions actives.
- **Autres annonces BLE visibles, sans H70B3** : vérifier la portée et l'état de la guirlande, puis relancer la découverte.

La liste repose sur les annonces BLE déjà reçues par HAOS, **pas sur l'adresse IP LAN** de la guirlande. Le bouton Actualiser relit cette liste ; il ne déclenche pas à lui seul un scan physique autonome.

Voir : [documentation ESPHome Bluetooth Proxy](https://esphome.io/components/bluetooth_proxy/) et [incident Home Assistant relatif au mode de scan Auto](https://github.com/home-assistant/core/issues/175664).

## Vérifications matérielles avant fusion dans main

1. Dans HAOS, constater que le capteur de transport indique `connected: false` après une image fixe, puis ouvrir Govee Home et vérifier que les commandes passent.
2. Lancer et arrêter un GIF navigateur dans LED Studio : vérifier que la lecture actuelle fonctionne et que `connected` repasse à `false` après l'arrêt.
3. Vérifier les changements ponctuels de pixel, la galerie et les opérations H6069 pour exclure toute régression.
4. Ne fusionner dans `main` qu'après validation sur le vrai matériel.

Aucune promesse de GIF autonome à ce stade : le protocole de transfert complet et de déclenchement des animations natives doit encore être identifié.
