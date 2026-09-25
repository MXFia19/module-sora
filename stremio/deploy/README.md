# Auto-déploiement de l'addon Sora

À chaque `push` sur `main`, le serveur se met à jour tout seul : il vérifie
GitHub, et s'il y a du neuf il reconstruit et relance le conteneur.

C'est du **polling** (le serveur interroge GitHub), pas un webhook. Raison :
la variante tunnel Cloudflare n'ouvre aucun port entrant, donc GitHub ne
pourrait pas joindre la box. Le polling marche pour les trois variantes de
compose sans rien exposer de plus.

Le cœur, c'est `../deploy.sh`. Il ne construit que si la branche distante a
bougé — un tick sans changement ne coûte qu'un `git fetch`.

---

## Installation (systemd — recommandé)

À faire **une seule fois**, sur le serveur. Remplace les trois valeurs en
haut, le reste se copie tel quel.

```bash
# --- à adapter ---
REPO=/chemin/vers/module-sora        # où le dépôt est cloné
USER_DOCKER=$(whoami)                # un utilisateur membre du groupe "docker"
# -----------------

# 1. Écrire les unités à partir des gabarits, chemins remplis.
sudo cp "$REPO/stremio/deploy/sora-deploy.timer" /etc/systemd/system/
sed -e "s|%UTILISATEUR%|$USER_DOCKER|g" \
    -e "s|%CHEMIN_STREMIO%|$REPO/stremio|g" \
    "$REPO/stremio/deploy/sora-deploy.service" \
  | sudo tee /etc/systemd/system/sora-deploy.service >/dev/null

# 2. Activer le timer.
sudo systemctl daemon-reload
sudo systemctl enable --now sora-deploy.timer
```

Vérifier :

```bash
systemctl list-timers sora-deploy.timer     # prochain déclenchement
sudo systemctl start sora-deploy.service    # forcer une passe tout de suite
journalctl -u sora-deploy.service -n 30     # voir ce qu'elle a fait
```

Le délai entre un push et sa mise en ligne est d'au plus 2 minutes (réglable
dans le `.timer`, ligne `OnUnitActiveSec`).

### Choisir la variante de compose

Par défaut le script réutilise le fichier compose du conteneur qui tourne
déjà (il ne bascule pas de mode par accident). Pour le figer, décommente dans
le `.service` :

```
Environment=COMPOSE_FILE=docker-compose.tunnel.yml
```

---

## Variante cron (si tu n'as pas systemd)

```bash
crontab -e
# puis, en une ligne :
*/2 * * * * /usr/bin/env bash /chemin/vers/module-sora/stremio/deploy.sh >> /var/log/sora-deploy.log 2>&1
```

---

## Ce que le script ne touche pas

- **`.env`** — jamais lu ni modifié. Tes clés restent où elles sont.
- **Le volume `sora_journal`** — conservé d'un déploiement à l'autre.
- **Les commits locaux** — le serveur est un miroir de lecture ; la branche
  est alignée durement sur le distant (`reset --hard`). N'édite pas le code
  directement sur le serveur, il serait écrasé au prochain push.

## Réglages

Variables d'environnement, toutes optionnelles (dans le `.service`, via
`Environment=`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `BRANCH` | `main` | branche suivie |
| `COMPOSE_FILE` | détecté | fichier compose à utiliser |
| `REMOTE` | `origin` | remote git |
| `PRUNE` | `1` | purger les images orphelines après build (évite que le disque se remplisse) |
