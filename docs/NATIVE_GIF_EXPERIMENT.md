# H70B3 — envoi GIF natif expérimental (0.5.3)

**Ne pas confondre avec le lecteur GIF existant.**
Ce fichier documente uniquement l'essai de transfert en une fois, pas une fonctionnalité matériellement confirmée.

## Fonction visée

LED Studio : charger un **GIF original exactement 20×26** (520 LED, **320 Kio max**), cliquer **« Envoyer GIF natif (test) »**. Le navigateur émet **une seule requête de service** `govee_led_control.upload_native_gif`, pas la boucle `set_frame`. Le transport ferme sa session BLE après upload/activation. Le GIF doit alors être animé de manière autonome, même après fermeture de LED Studio, et laisser Govee Home reprendre le contrôle de façon durable.

## Fondement du protocole

Les classes extraites de Govee Home sur un H70B3 confirment :
- `EffectH70b3Gif.getBytes()` : renvoie **`0x5D` + les octets du GIF original** depuis `GifDecodeV1Info`.
- Le décodeur `EffectH70b3Gif$parse$2$1` retire deux octets de l'enveloppe d'effet reçue et reconstitue un fichier `diy_effect_gif.gif`.
- `H70b3GifParse.makeBleMaterialGifController()` préfixe l'argument `graffitiBytes` par `0x5D`, puis `Compose4DefWrite4Multi.c/d((byte) 88, ...)`.
- `Ble.java` H70B3 expose le service `…1910` et la caractéristique `…2b11`.
- L'implémentation `Compose4DefWrite4Multi` est absente des APK fournis (uniquement une référence de type). **La compatibilité du format de fragmentation est supposée**, par analogie avec l'encodeur `A4/58` déjà validé pour les images statiques.

## Implémentation dans la branche feature/ble-connection-release

- `h70b3_protocol.py` : validation du GIF, `build_native_gif_effect`, séparation du packetizer `build_effect_upload_packets`; l'encodeur statique `0x5F` existant est conservé.
- `h70b3_ble.py` : méthode `async_send_native_gif` ; authentification E7, chiffrement, transfert `A4/58`, attente d'ACK, commande `ACTIVATE` déjà utilisée pour les PNG statiques, déconnexion en `finally`.
- `h70b3_controller.py` : suppression des transferts d'image en attente au moment d'un upload natif.
- `__init__.py`, `const.py`, `services.yaml` : service volontaire `govee_led_control.upload_native_gif` avec charge `gif_base64`.
- `frontend/govee-led-studio.js` : bouton expérimental distinct du lecteur GIF frame-par-frame, disponible pour un fichier GIF 20×26 original chargé depuis le navigateur. Les éléments de galerie existants contiennent seulement des frames décodées, pas le fichier original.
- `tests/test_protocol.py` : vérification du préfixe 0x5D, des limites, de l'encapsulation A4/58 et de la non-régression des PNG.

## Contrôle physique restant impératif

1. Déployer **la version 0.5.3 de la branche de développement**, sans fusionner dans `main`. Redémarrer Home Assistant, recharger la carte JS (Ctrl+F5).
2. Ouvrir LED Studio ; charger le GIF de test H70B3 `20×26`. Ne pas appuyer sur le bouton « Lire » (streaming).
3. Cliquer **« Envoyer GIF natif (test) »** et observer le résultat. Un statut de transfert « réussi » signifie seulement que **les acquittements BLE** ont été reçus ; il ne démontre PAS que le H70B3 joue le GIF.
4. Si l'animation est visible : quitter LED Studio et fermer le navigateur ; elle doit **continuer**.
5. Modifier l'effet dans Govee Home : il doit **rester** sans retour au GIF.
6. Si échec : relever uniquement le message d'erreur affiché par LED Studio et `last_error` du capteur transport. Ne pas multiplier les tentatives ou supposer que l'ACK valide l'activation native.

## Limitations / prudence

- **Protocole GIF natif non validé sur matériel** : possibilité que la commande d'activation diffère ou que le firmware attende une autre segmentation/procédure d'enregistrement. Ce code est un **essai contrôlé et opt-in**, pas une réussite annoncée.
- La boucle GIF existante est conservée comme mode de repli, et demeure arrêtée lors des changements de page pour ne pas empêcher Govee Home de reprendre le contrôle.
- L'expérience ne doit pas intervenir sur les intégrations H6069 ou les images fixes existantes.
- Ne pas engager de flash OTA ou d'opérations de firmware dans cette expérience.

Documentation générale : voir README.md.

## Validation matérielle complète — 21/11/2026

- ✅ Transfert depuis LED Studio 0.5.3 et lecture GIF sur la H70B3 : validé par l'utilisateur.
- ✅ En quittant la page LED Studio, l'animation continue : validé par l'utilisateur.
- ✅ En choisissant un autre effet dans Govee Home, le nouvel effet reste actif et LED Studio ne réimpose pas le GIF : validé par l'utilisateur.

**Le GIF natif autonome et la coexistence avec Govee Home sont donc confirmés sur le matériel testé.** Les réserves de début de document correspondent à l'état *avant* ces vérifications. Le support universel de tous les GIF n'est pas démontré.
