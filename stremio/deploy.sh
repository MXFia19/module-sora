#!/usr/bin/env bash
# ==========================================================================
# Auto-déploiement de l'addon Sora
# ==========================================================================
# Vérifie si la branche suivie a avancé sur GitHub et, si oui, met à jour le
# dépôt et reconstruit le conteneur. Conçu pour tourner en boucle (timer
# systemd ou cron) : à chaque push, le serveur se met à jour tout seul.
#
# Pourquoi du polling et pas un webhook : la variante tunnel Cloudflare
# n'ouvre aucun port entrant, donc GitHub ne pourrait pas joindre la box. Le
# polling marche pour les trois variantes de compose sans rien exposer.
#
# Réglages (variables d'environnement, toutes optionnelles) :
#   BRANCH        branche à suivre           (défaut : main)
#   COMPOSE_FILE  fichier compose à utiliser (défaut : détecté, voir plus bas)
#   REMOTE        remote git                 (défaut : origin)
#   PRUNE         "1" pour purger les images orphelines après build (défaut : 1)
#
# Le script ne construit QUE si la branche distante a bougé — un tick sans
# changement ne coûte qu'un « git fetch ».
# --------------------------------------------------------------------------
set -euo pipefail

BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
PRUNE="${PRUNE:-1}"

# Le script vit dans stremio/ ; le dépôt git est le dossier parent.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STREMIO_DIR="$SCRIPT_DIR"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && git rev-parse --show-toplevel)"

log() { printf '%s [deploy] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# --- verrou : deux ticks ne doivent jamais se chevaucher ------------------
# flock rend le tick idempotent même si un build déborde sur le suivant.
LOCK="/tmp/sora-deploy.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  log "un déploiement est déjà en cours, on passe ce tick."
  exit 0
fi

# --- choix du fichier compose ---------------------------------------------
# Priorité : COMPOSE_FILE explicite → celui du conteneur qui tourne déjà →
# docker-compose.yml par défaut. On ne devine pas la variante à ta place si
# tu l'as figée, mais on retombe sur ce qui tourne pour ne pas basculer de
# mode par accident.
pick_compose() {
  if [ -n "${COMPOSE_FILE:-}" ]; then echo "$COMPOSE_FILE"; return; fi
  # Le label compose du conteneur en cours nomme son fichier d'origine.
  local running
  running="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' sora-stremio 2>/dev/null || true)"
  if [ -n "$running" ] && [ -f "$running" ]; then echo "$running"; return; fi
  echo "docker-compose.yml"
}

cd "$REPO_ROOT"

# --- y a-t-il du neuf ? ----------------------------------------------------
git fetch --quiet "$REMOTE" "$BRANCH"
LOCAL="$(git rev-parse HEAD)"
REMOTE_REV="$(git rev-parse "$REMOTE/$BRANCH")"

if [ "$LOCAL" = "$REMOTE_REV" ]; then
  # Rien à faire : le cas de très loin le plus fréquent, on sort en silence.
  exit 0
fi

log "nouveau commit : ${LOCAL:0:7} -> ${REMOTE_REV:0:7}, déploiement."

# --- mise à jour du dépôt --------------------------------------------------
# On aligne durement la branche sur le distant plutôt qu'un merge : le serveur
# est un miroir de lecture, il n'a pas de commits propres à préserver.
git checkout --quiet "$BRANCH"
git reset --hard --quiet "$REMOTE/$BRANCH"

# --- build + redémarrage ---------------------------------------------------
cd "$STREMIO_DIR"
COMPOSE="$(pick_compose)"
log "compose : $COMPOSE"

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"   # ancienne CLI, au cas où
fi

# --build reconstruit l'image (le TypeScript est compilé dans le Dockerfile),
# -d la relance en arrière-plan. Compose ne recrée que ce qui a changé.
$DC -f "$COMPOSE" up -d --build

if [ "$PRUNE" = "1" ]; then
  # Les anciennes images s'accumulent à chaque build et remplissent le disque.
  docker image prune -f >/dev/null 2>&1 || true
fi

log "déployé : $(git rev-parse --short HEAD)"
