# Mettre l'addon en ligne

Trois façons, de la plus solide à la plus économe. Dans tous les cas, ce que
vous partagez à la fin est **une seule URL** : `https://votre-domaine/configure`.
Chacun y règle ce qu'il veut et repart avec son propre lien d'installation.

---

## Option A — VPS + domaine (recommandé)

Ce qu'il faut : un VPS à quelques euros par mois et un nom de domaine.

Un VPS d'entrée de gamme suffit largement : l'addon consomme surtout du réseau,
très peu de CPU et de RAM. Comptez 2 Go de RAM, et **regardez le quota de
trafic** plutôt que le processeur — c'est lui qui limite si vous laissez le
proxy actif (voir « bande passante » dans le README).

### 1. Le serveur

Prenez une image **Debian 12** ou **Ubuntu 24.04**, connectez-vous en SSH, puis :

```bash
# Docker, méthode officielle
curl -fsSL https://get.docker.com | sh

# Pare-feu : SSH + HTTP + HTTPS, rien d'autre
apt install -y ufw
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
```

Les ports 80 et 443 doivent être ouverts **avant** de lancer : Caddy en a
besoin pour prouver à Let's Encrypt que le domaine est bien à vous.

### 2. Le domaine

Chez votre registraire, créez un enregistrement **A** qui pointe sur l'IP du
serveur :

| Type | Nom | Valeur |
|---|---|---|
| A | `sora` | `203.0.113.42` (l'IP de votre VPS) |

Vérifiez avant de continuer, la propagation prend de quelques minutes à une
heure :

```bash
dig +short sora.exemple.fr    # doit renvoyer l'IP du VPS
```

Pas envie d'acheter un domaine ? [DuckDNS](https://www.duckdns.org) donne un
sous-domaine gratuit qui marche très bien ici.

### 3. L'addon

```bash
git clone -b gh-main-r2ievx https://github.com/MXFia19/module-sora
cd module-sora/stremio
cp .env.example .env
```

Éditez `.env` — deux lignes suffisent :

```bash
TMDB_API_KEY=votre_clé        # repli pour ceux qui n'apportent pas la leur
PROXY_SECRET=...              # openssl rand -hex 32
PROBE_DIRECT=true             # ~87 % des flux sortent du proxy
```

Puis :

```bash
ADDON_DOMAIN=sora.exemple.fr docker compose -f docker-compose.public.yml up -d --build
```

Caddy demande le certificat tout seul. Au bout de quelques secondes :

```bash
curl https://sora.exemple.fr/health
```

Vous devez voir `{"ok":true,...}` avec les cinq sources. C'est en ligne.

### 4. Partager

Donnez `https://sora.exemple.fr/configure`. Conseillez à vos utilisateurs
d'apporter leur clé TMDB et de laisser le mode « direct » : votre quota et
votre bande passante ne bougent alors pas.

---

## Oracle Cloud Always Free — les spécificités

C'est la meilleure offre gratuite pour cet usage, mais elle a trois pièges qui
ne se posent nulle part ailleurs.

### Ce que vous avez

| | Ampere A1 (ARM) | E2.1.Micro (AMD) |
|---|---|---|
| Ressources | jusqu'à 4 OCPU / 24 Go | 1/8 OCPU / 1 Go |
| Débit réseau | selon la taille | **50 Mbps** |
| Trafic sortant | **10 To/mois**, sur les deux | |

Les 10 To changent la donne par rapport à un VPS ordinaire : **vous pouvez
laisser le proxy actif**. À ~3,5 Go le film, cela représente environ 2 800
films par mois. `PROBE_DIRECT=true` reste utile — moins vous relayez, moins
vous êtes exposé — mais ce n'est plus une nécessité budgétaire.

Sur le Micro, c'est le plafond de **50 Mbps** qui limite : environ 12 lectures
simultanées à 4 Mbps. Réglez `PROXY_MAX_CONCURRENT=10` en conséquence.

### Piège 1 — le pare-feu interne, celui qui fait perdre une soirée

Ouvrir les ports dans la console Oracle **ne suffit pas**. Les images Oracle
embarquent en plus des règles iptables restrictives *dans* la machine. Tant
qu'on ne les touche pas, le port paraît ouvert côté cloud et reste muet.

Il faut donc faire les deux :

**a) Côté console Oracle** — Networking → VCN → Security Lists → *Add Ingress
Rules* :

| Source | Protocole | Port |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

**b) Dans la machine**, en SSH :

```bash
# Ubuntu sur OCI
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# Oracle Linux (firewalld)
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp
sudo firewall-cmd --reload
```

Si Caddy n'obtient pas son certificat, c'est neuf fois sur dix ce point b) qui
manque.

### Piège 2 — la récupération des instances inactives

Oracle reprend les instances Always Free jugées inactives. Les critères, sur
une fenêtre de 7 jours, sont cumulatifs — l'instance n'est reprise que si
**tous** sont vrais :

- CPU au 95ᵉ centile < 20 %
- réseau < 20 %
- mémoire < 20 % (sur les formes A1 uniquement)

Un addon qui sert quelques requêtes par jour coche les trois. Le réflexe n'est
pas de faire tourner une boucle inutile, mais de **prendre une forme à votre
taille** : une A1 à 1 OCPU / 6 Go franchit naturellement les seuils là où une
4 OCPU / 24 Go restera sous la barre quoi que vous fassiez. Le Micro n'est pas
concerné par le critère mémoire, et son huitième d'OCPU dépasse 20 % dès qu'il
travaille un peu.

### Piège 3 — l'architecture ARM

Si vous avez pris une A1, vous êtes en `aarch64`. Notre image se construit
depuis les sources et `node:22-alpine` est multi-architecture, donc
`docker compose up -d --build` fonctionne tel quel. C'est seulement à retenir
si vous ajoutez un jour une dépendance avec du binaire natif.


### Créer l'instance

Avant tout, il faut une machine — la liste *Compute → Instances* est vide au
départ. Bouton **Create instance**, puis :

**Image et forme** — bouton *Edit* de la section « Image and shape ».

- Image : **Canonical Ubuntu 24.04**. Les commandes de ce guide la supposent.
- Forme : *Change shape*, puis au choix
  - **Ampere / VM.Standard.A1.Flex** réglée sur **1 OCPU et 6 Go**. C'est le
    bon compromis : assez pour l'addon, et assez petit pour franchir
    naturellement les seuils d'activité d'Oracle (voir « Piège 2 »).
  - **VM.Standard.E2.1.Micro** (AMD) si l'Ampere est indisponible.

> ⚠️ Vérifiez l'étiquette verte **« Always Free-eligible »** sur la forme
> choisie. Sans elle, l'instance est facturée.

**Réseau** — laissez Oracle créer un nouveau VCN (*Create new virtual cloud
network*), puis vérifiez que **« Automatically assign public IPv4 address »**
est bien activé. Sans adresse publique, la machine n'est joignable de nulle
part.

> Si le bouton est grisé avec *« You must select a public subnet to assign a
> public IPv4 address »*, c'est que le sous-réseau choisi est **privé** — un
> sous-réseau privé n'a pas de route vers la passerelle Internet, donc aucune
> adresse publique ne peut y être attachée. Remontez dans la section
> *Networking* et, au choix :
>
> - sélectionnez **Create new virtual cloud network** : Oracle crée alors un
>   VCN complet avec passerelle Internet et sous-réseau public, et le bouton
>   se débloque ;
> - ou, pour garder un VCN existant, choisissez sous *Subnet* celui dont le
>   nom contient **Public** (l'assistant de création de VCN en produit
>   toujours un, à côté du privé).

**Clé SSH** — choisissez *Generate a key pair for me* et **téléchargez la clé
privée** avant de continuer. Oracle ne la propose qu'une fois ; si vous
passez à côté, il faut recréer l'instance.

**Volume** — les 50 Go proposés par défaut conviennent.

Puis **Create**. L'instance est prête en une à deux minutes, et son adresse
apparaît dans la colonne *Public IP*.

#### Si Oracle répond « Out of host capacity »

C'est fréquent sur les formes Ampere, très demandées. Dans l'ordre :

1. changez de **domaine de disponibilité** (AD-1, AD-2, AD-3) et réessayez ;
2. réduisez la taille demandée (1 OCPU passe plus souvent que 4) ;
3. prenez le **Micro AMD**, presque toujours disponible ;
4. ou réessayez plus tard : la capacité se libère par vagues.

### Premier lancement, pas à pas (sans domaine)

Le plus simple est de faire tourner l'addon sur l'IP brute d'abord. Ça marche
dans Stremio Desktop et Android, et ça évite de bloquer sur le DNS et le
certificat le premier jour. Le domaine et le HTTPS s'ajoutent après.

**1. Se connecter.** L'IP publique est dans la console Oracle : *Compute →
Instances → votre instance → Public IP address*. L'utilisateur dépend de
l'image : `ubuntu` pour Ubuntu, `opc` pour Oracle Linux. Sur Windows, ces
commandes fonctionnent dans PowerShell.

```bash
chmod 600 votre-cle.key        # sinon SSH refuse de s'en servir
ssh -i votre-cle.key ubuntu@VOTRE_IP
```

**2. Faire le point.** Le script ne modifie rien, il affiche seulement l'état :

```bash
sudo apt update && sudo apt install -y git curl
git clone -b main https://github.com/MXFia19/module-sora
cd module-sora/stremio
bash scripts/diagnostic.sh
```

Il vous dit votre architecture, votre IP publique, ce qui manque au pare-feu
et si Docker est là. Gardez sa sortie sous les yeux pour les étapes suivantes.

**3. Ouvrir le port 7000, des DEUX côtés.**

Dans la console Oracle : *Networking → Virtual Cloud Networks → votre VCN →
Security Lists → Default Security List → Add Ingress Rules*

| Source | Protocole | Port |
|---|---|---|
| `0.0.0.0/0` | TCP | 7000 |

Puis dans la machine :

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 7000 -j ACCEPT
sudo netfilter-persistent save
```

**4. Installer Docker.**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit                           # se déconnecter puis se reconnecter
```

La reconnexion est nécessaire : l'appartenance au groupe `docker` n'est prise
en compte qu'à l'ouverture de session.

**5. Lancer.**

```bash
cd module-sora/stremio
cp .env.example .env
nano .env                      # TMDB_API_KEY, et PUBLIC_URL=http://VOTRE_IP:7000
docker compose up -d --build
```

La première construction prend quelques minutes.

**6. Vérifier.**

```bash
bash scripts/diagnostic.sh
```

La dernière section doit afficher « joignable depuis l'extérieur ». Sinon,
c'est une des deux moitiés du pare-feu qui manque.

**7. Installer dans Stremio.** Collez `http://VOTRE_IP:7000/manifest.json`
dans *Addons → Install via URL*, ou ouvrez
`stremio://VOTRE_IP:7000/manifest.json`.

**Et après ?** Quand ça marche, ajoutez un domaine et repassez sur
`docker-compose.public.yml` pour avoir le HTTPS — indispensable pour
`web.stremio.com` et pour partager proprement.

### Ensuite

Le reste est identique à l'option A : installer Docker, pointer le DNS,
lancer `docker-compose.public.yml`. Pensez simplement à faire les deux moitiés
du pare-feu avant de lancer Caddy.

---

## Option B — depuis chez vous, sans ouvrir de port

Pour héberger sur une machine à la maison (vieux PC, Raspberry Pi, NAS) sans
exposer votre IP ni toucher à la box. Un tunnel Cloudflare sort **depuis** chez
vous, donc rien à ouvrir en entrée.

1. Sur [dash.cloudflare.com](https://dash.cloudflare.com) → **Zero Trust** →
   **Networks** → **Tunnels** → **Create a tunnel** → type *Cloudflared*.
2. Ajoutez un **Public hostname** : votre sous-domaine → service
   `http://sora-stremio:7000`.
3. Copiez le **jeton** du tunnel, puis sur votre machine :

```bash
cp .env.example .env          # TMDB_API_KEY
TUNNEL_TOKEN=eyJ... ADDON_DOMAIN=sora.exemple.fr \
  docker compose -f docker-compose.tunnel.yml up -d --build
```

Cloudflare fournit le HTTPS, il n'y a donc pas de Caddy dans cette variante.

**Le proxy est désactivé de force ici**, et c'est volontaire : les conditions
d'utilisation de Cloudflare interdisent de faire transiter de gros volumes
vidéo par leur réseau. En mode direct, seul du JSON passe par le tunnel — la
vidéo va du CDN au lecteur sans nous — et vous restez dans les clous.

---

## Option C — une plateforme gratuite, en mode direct

**Vercel et Netlify sont à écarter d'emblée**, quelle que soit la
configuration. Leurs conditions d'usage nomment explicitement *Proxies*,
*Scrapers* et *Media hosting for hot-linking* parmi les usages jamais
autorisés : cet addon est les trois à la fois, et la sanction est la
suspension du compte. Ce n'est pas une question de limites techniques — la
durée d'exécution y serait largement suffisante.

Restent les plateformes à conteneur. En mode direct, l'addon n'est qu'une API
JSON : quelques kilo-octets par requête. Les offres gratuites de Railway,
Render, Fly.io ou Koyeb peuvent tenir, à condition de :

- garder `PROXY_ENABLED=false` (l'egress facturé est ce qui coûte cher là-bas) ;
- accepter le démarrage à froid : une instance endormie met plusieurs secondes
  à répondre, et Stremio peut abandonner entre-temps ;
- accepter le risque de blocage : les sites sources voient une IP de datacenter
  partagée. C'est déjà ce qui a fait répondre 403 à lulustream depuis mon
  serveur de test ;
- accepter de perdre le cache à chaque réveil d'instance, donc de rescraper
  les cinq sites à chaque ouverture de fiche — ce qui aggrave le point
  précédent.

Utilisable pour essayer, fragile pour durer. Un VPS à 4 € règle les trois.

---

## Option D — page statique seule, l'addon chez chaque utilisateur

Si vous ne voulez rien héberger qui tourne, `npm run build:static` produit une
page **autonome** : un seul fichier HTML de 12 Ko, sans serveur derrière. Elle
fabrique le lien dans le navigateur, à partir d'une adresse que l'utilisateur
saisit.

```bash
npm run build:static          # écrit dist-static/index.html
```

Déposez `dist-static/` sur Vercel, Netlify, GitHub Pages, Cloudflare Pages —
n'importe lequel, gratuitement.

### Avec GitHub Pages, automatiquement

Le dépôt contient déjà le workflow `.github/workflows/pages.yml`. Une seule
chose à faire, une fois :

**Settings → Pages → Source → « GitHub Actions »**

Sans ce réglage, le job de déploiement échoue à sa dernière étape : Pages
refuse un artefact tant que la source est restée sur « Deploy from a branch ».

Ensuite, chaque modification de la page sur `main` la republie. Le workflow
lance les tests avant de déployer — une page qui fabriquerait des liens
illisibles par l'addon ne doit pas partir en production. L'adresse finale est
`https://<votre-compte>.github.io/module-sora/`.

Pour publier sans attendre un push : onglet **Actions** → *Page
d'installation* → **Run workflow**.

Le workflow ne se déclenche que sur `main`. Tant que la branche de
développement n'est pas fusionnée, utilisez le bouton **Run workflow**.

### À la main, sans Actions

```bash
npm run build:static
git checkout --orphan gh-pages
git rm -rf . && cp stremio/dist-static/index.html .
git add index.html && git commit -m "page d'installation"
git push -u origin gh-pages
```

Puis **Settings → Pages → Source → Deploy from a branch → `gh-pages` / root**. **Rien n'y scrape ni n'y proxifie**, donc
aucune des conditions d'usage qui excluent cet addon d'un PaaS ne s'applique :
c'est de l'HTML statique, au même titre qu'un blog.

Ce que ça résout : la configuration, qui est la partie pénible. La page donne
la commande à lancer, et fabrique le lien réglé aux préférences de chacun.

**Ce que ça ne résout pas** : chaque utilisateur doit toujours lancer l'addon
chez lui (`docker compose up -d`). La page rend cette étape confortable, elle
ne la supprime pas.

Le choix se pose donc ainsi :

| | Qui héberge | Ce que l'utilisateur fait | Coût pour vous |
|---|---|---|---|
| Options A / B | Vous | Colle une URL | VPS ou machine allumée |
| Option D | Personne | Lance un conteneur, puis colle l'URL | Rien |

Un dernier point en faveur de D, au-delà du coût : chaque utilisateur scrape
depuis **sa propre IP résidentielle**. Aucune IP partagée à faire bannir, et
votre responsabilité s'arrête à une page HTML.

---

## Ensuite

**Mettre à jour :**

```bash
cd module-sora && git pull
cd stremio && ADDON_DOMAIN=sora.exemple.fr docker compose -f docker-compose.public.yml up -d --build
```

**Voir ce qui se passe :**

```bash
docker compose -f docker-compose.public.yml logs -f sora-stremio
```

Chaque requête est tracée avec le pseudo de l'utilisateur, le nombre de flux
et le temps de réponse. `LOG_LEVEL=debug` dans `.env` ajoute chaque requête
sortante — utile quand une source ne rend rien, trop bavard au quotidien.

**Si ça ne marche pas :**

| Symptôme | Cause la plus fréquente |
|---|---|
| Caddy n'obtient pas de certificat | DNS pas encore propagé, ou port 80 fermé. `dig +short` et `ufw status`. |
| L'addon s'installe mais aucun flux | Clé TMDB absente ou invalide. `curl https://.../health`, puis les logs. |
| Les flux s'affichent mais rien ne se lance | `PUBLIC_URL` ne correspond pas à l'adresse que le client atteint. C'est l'erreur numéro un. |
| Tout est lent | Une source à la traîne. Conseillez « réponse rapide dès 5 flux » dans `/configure`. |
