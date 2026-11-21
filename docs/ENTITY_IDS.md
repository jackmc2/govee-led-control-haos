# Identifiants d'entités — Govee LED Control HAOS 0.5.2

## Convention de nommage

- **Étiquettes dans Home Assistant** : français, par exemple « Transport de contrôle » et « LED ligne 01 colonne 01 ».
- **Identifiants d'entité** (`entity_id`) : anglais explicite, en minuscules et séparés par des underscores.
- **Identifiants uniques internes** (`unique_id`) : **inchangés** pour permettre à Home Assistant de retrouver chaque entité existante.
- **Domaine d'intégration** : `govee_led_control`, inchangé.
- **Nom du périphérique** : `Govee_H70B3_4148` peut être renommé dans l'interface HAOS, sans nécessité technique.

Les préfixes des identifiants d'entités peuvent varier en fonction de l'historique et des choix utilisateur. Les exemples ci-dessous illustrent les suffixes définitifs.

| Fonction | Avant (néerlandais) | Après (anglais) |
| --- | --- | --- |
| Capteur de transport | `sensor.…_volledige_controle_via` | `sensor.…_transport` |
| LED ligne 1 colonne 1 | `light.…_led_r01_k01` | `light.…_led_row01_col01` |
| LED ligne 26 colonne 20 | `light.…_led_r26_k20` | `light.…_led_row26_col20` |
| Miroir horizontal | `switch.…_horizontaal_spiegelen` | `switch.…_flip_horizontal` |
| Miroir vertical | `switch.…_verticaal_spiegelen` | `switch.…_flip_vertical` |
| Niveau de visualisation | `number.…_demo_sensorniveau` | `number.…_visual_level` |
| Style de visualisation | `select.…_sensorvisualisatie` | `select.…_visual_style` |
| Extinction | `button.…_alles_zwart` | `button.…_clear` |
| Démonstration | `button.…_bewezen_demo_tonen` | `button.…_demo` |
| Topologie H6069 | `sensor.…_paneelindeling` | `sensor.…_topology` |
| Panneau H6069 | `light.…_paneel_01` | `light.…_panel_01` |

## Migration au prochain redémarrage

En passant de la version 0.5.1 à la branche de développement 0.5.2 :

1. Home Assistant charge la configuration existante avec ses mêmes `config_entry_id` et `unique_id`.
2. L'intégration repère uniquement les entités de **sa propre entrée de configuration** dont l'`entity_id` se termine par un ancien suffixe néerlandais répertorié.
3. Elle renomme l'`entity_id` via l'**API officielle du registre d'entités Home Assistant** avant de charger les plateformes. Elle ne modifie jamais directement les fichiers `.storage`.
4. Un conflit de nom provoque un abandon de ce renommage particulier, sans arrêter l'intégration.
5. Les entités personnalisées avec un autre identifiant ne sont pas modifiées. L'opération est idempotente.

**Conséquence importante :** les automatisations, scripts, dashboards et appels externes qui utilisent textuellement un ancien `entity_id` doivent être actualisés. Leurs références ne sont pas automatiquement réécrites. Il est recommandé de sauvegarder HAOS avant la première mise à jour.

LED Studio recherche désormais le capteur de transport par son modèle et son identifiant de configuration, même si son `entity_id` a changé.

## Validation

- Tests unitaires pour les suffixes néerlandais, les positions ligne/colonne, les identifiants personnalisés et les collisions.
- Hassfest et validation de syntaxe JavaScript par GitHub Actions.
- **Essai réel sur HAOS nécessaire** avant fusion de la PR #1.

> Ce changement ne constitue pas un transfert de GIF autonome et ne modifie pas la méthode d'envoi Bluetooth des images.
