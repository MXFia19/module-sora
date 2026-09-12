#!/usr/bin/env bash
# Fait le point sur la machine : forme, architecture, pare-feu, Docker, addon.
#
# Ce script ne MODIFIE rien. Il ne fait que lire et afficher, pour que vous
# sachiez quoi lancer ensuite — et pour qu'on puisse diagnostiquer à deux si
# quelque chose ne répond pas.
#
#   bash scripts/diagnostic.sh

titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
non()   { printf '  \033[31m✗\033[0m %s\n' "$1"; }
info()  { printf '    %s\n' "$1"; }

titre "Machine"
arch=$(uname -m)
cpus=$(nproc 2>/dev/null || echo '?')
ram=$(free -h 2>/dev/null | awk '/^Mem:/{print $2}' || echo '?')
info "architecture : $arch"
info "processeurs  : $cpus"
info "mémoire      : $ram"

case "$arch" in
  aarch64) ok "forme Ampere A1 (ARM) — pas de plafond réseau serré" ;;
  x86_64)  ok "forme AMD — si c'est le Micro (1 Go), plafond réseau 50 Mbps" ;;
  *)       info "architecture inhabituelle : $arch" ;;
esac

if [ "$cpus" != "?" ] && [ "$cpus" -ge 4 ] 2>/dev/null; then
  info "⚠ 4 cœurs ou plus : surveillez le critère d'inactivité d'Oracle"
  info "  (reprise si CPU, réseau ET mémoire restent sous 20 % pendant 7 jours)"
fi

titre "Adresse publique"
ip=$(curl -sS --max-time 8 https://api.ipify.org 2>/dev/null)
if [ -n "$ip" ]; then
  ok "IP publique : $ip"
  info "c'est elle qu'il faudra mettre dans PUBLIC_URL"
else
  non "IP publique introuvable (pas de sortie Internet ?)"
fi

titre "Pare-feu interne"
# Le piège Oracle : la Security List du VCN ne suffit pas, il y a AUSSI des
# règles dans la machine.
if command -v iptables >/dev/null 2>&1; then
  for port in 7000 80 443; do
    if sudo iptables -S INPUT 2>/dev/null | grep -qE "dport $port .*ACCEPT"; then
      ok "port $port autorisé par iptables"
    else
      non "port $port NON autorisé par iptables"
      info "sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport $port -j ACCEPT"
    fi
  done
  info "puis : sudo netfilter-persistent save"
elif command -v firewall-cmd >/dev/null 2>&1; then
  ouverts=$(sudo firewall-cmd --list-ports 2>/dev/null)
  info "firewalld, ports ouverts : ${ouverts:-aucun}"
  for port in 7000 80 443; do
    case "$ouverts" in
      *"$port/tcp"*) ok "port $port ouvert" ;;
      *) non "port $port fermé — sudo firewall-cmd --permanent --add-port=$port/tcp" ;;
    esac
  done
  info "puis : sudo firewall-cmd --reload"
else
  info "ni iptables ni firewalld détectés"
fi
info "⚠ N'oubliez pas l'AUTRE moitié : Security List du VCN dans la console Oracle."

titre "Docker"
if command -v docker >/dev/null 2>&1; then
  ok "$(docker --version)"
  if docker compose version >/dev/null 2>&1; then
    ok "$(docker compose version | head -1)"
  else
    non "plugin compose absent"
  fi
  if docker ps >/dev/null 2>&1; then
    ok "démon accessible"
  else
    non "démon inaccessible — essayez avec sudo, ou : sudo usermod -aG docker \$USER puis reconnectez-vous"
  fi
else
  non "Docker absent — curl -fsSL https://get.docker.com | sh"
fi

titre "Addon"
port=${PORT:-7000}
if reponse=$(curl -sS --max-time 6 "http://127.0.0.1:$port/health" 2>/dev/null); then
  ok "répond sur le port $port"
  info "$reponse"
  if [ -n "$ip" ]; then
    if curl -sS --max-time 10 -o /dev/null "http://$ip:$port/health" 2>/dev/null; then
      ok "joignable depuis l'extérieur : http://$ip:$port/manifest.json"
    else
      non "répond en local mais PAS depuis l'extérieur"
      info "il manque une moitié du pare-feu (voir plus haut)"
    fi
  fi
else
  non "ne répond pas sur le port $port"
  info "démarrez-le : docker compose up -d --build"
fi
