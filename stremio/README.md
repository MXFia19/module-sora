# Sora — addon Stremio

Portage autonome des modules Sora vers Stremio. Cinq sources françaises :
**movix**, **purstream**, **anime-sama**, **voir-anime**, **nakanime**.

Projet indépendant : pas de fork à resynchroniser, pas de SDK non maintenu.
Un serveur Node + TypeScript, un conteneur, aucune base de données.

**Validé en conditions réelles** : les cinq sources rendent des flux, et la
chaîne HLS complète (manifeste → variante → segment) a été jouée à travers le
proxy jusqu'à récupérer de la vidéo MPEG-TS. Voir [Résultats de validation](#résultats-de-validation).

## Installation

```bash
cp .env.example .env       # renseigner au minimum TMDB_API_KEY
docker compose up -d --build
```

Puis, dans Stremio : **Addons → Install via URL** et coller

```
http://<votre-hôte>:7000/manifest.json
```

Sans Docker :

```bash
npm install
npm run build
TMDB_API_KEY=xxx npm start
```

## Configuration

Tout passe par l'environnement, voir `.env.example`. Les deux réglages qui
comptent vraiment :

| Variable | Pourquoi |
|---|---|
| `TMDB_API_KEY` | Obligatoire. Stremio donne un id IMDb, les sources parlent TMDB. |
| `PUBLIC_URL` | L'adresse que **le client** doit atteindre. Les liens proxifiés sont absolus : sans elle, ils pointent `127.0.0.1`. |

## Pourquoi un proxy intégré

La plupart des hébergeurs exigent un `Referer` ou un `Origin` précis, et
Stremio ne les transmet pas de façon fiable. Les flux qui en ont besoin sont
donc réécrits vers `/proxy/s`, qui réinjecte les headers côté serveur.

Le proxy réécrit aussi les manifestes HLS : variantes, segments et clés de
déchiffrement repassent par lui. Ne proxifier que le manifeste ne servirait à
rien — les segments partiraient en direct, et l'hébergeur répondrait 403.

Les liens sont **signés** (HMAC) et **datés**. Sans cela, l'addon serait un
proxy HTTP ouvert que n'importe qui pourrait faire relayer vers n'importe
quelle cible.

## Diagnostiquer une source muette

### La page /debug

```bash
DEBUG_UI=true docker compose up -d --build   # ou DEBUG_UI=true dans .env
```

Puis `http://votre-hôte:7000/debug`. Un champ, un bouton, et le verdict de
chaque source :

- **une carte par source**, verte si elle rend des flux, orange si elle n'en
  rend aucun, rouge si elle échoue ou dépasse son budget ;
- **ses logs à elle**, capturés séparément — les sources tournent en
  parallèle, leurs lignes s'entrelacent dans la console, ici elles sont
  démêlées ;
- **l'état réel de chaque flux** : chaque lien est réellement sollicité, et la
  page affiche le code HTTP obtenu. Une source qui rend dix liens dont aucun
  ne répond a l'air de marcher dans les logs ; ici ça se voit ;
- **ce que TMDB a résolu** : titre, année, identifiant, épisode absolu, et la
  liste des titres essayés pour le rapprochement.

Les cartes en défaut s'ouvrent d'office — c'est ce qu'on vient regarder.

`DEBUG_UI` est fermé par défaut : la page expose le fonctionnement interne et
laisse déclencher des scrapes à volonté, ce qui n'a rien à faire sur une
instance ouverte au public.

### La console en direct

`http://votre-hôte:7000/debug/live` — à laisser ouverte sur un écran pendant
qu'on se sert de Stremio **depuis un autre appareil**.

`/debug` répond à « cette source marche-t-elle ? » en la testant. La console
répond à une autre question : « que s'est-il passé quand mon téléphone a
ouvert cet épisode ? ». On ne peut pas rejouer la requête d'un client distant,
il faut l'observer au vol.

Chaque requête apparaît comme une carte :

```
19:04:12  Interstellar  tt0816692        8/8 flux   5207ms   192.168.1.34
          Purstream      1 flux   2592ms
          Movix         10 flux   4346ms
```

Avec l'adresse du client — pratique pour distinguer le téléphone du PC —, le
pseudo de la configuration utilisée, et si la réponse venait du cache. Les
requêtes qui rendent **zéro flux** se déplient d'office.

En dessous, le journal brut défile en temps réel, filtrable par niveau, avec
une pause pour lire tranquillement.

Techniquement c'est du Server-Sent Events : unidirectionnel, ça traverse les
proxies sans négociation, et le navigateur se reconnecte seul. `/health`
indique le nombre de consoles connectées.

### En ligne de commande

```bash
npm run build
npm run probe -- movie tt0816692
npm run probe -- series tt0944947:1:1 --only animesama
LOG_LEVEL=debug npm run probe -- series tmdb:1429:1:1
```

La sonde rejoue exactement ce que fait Stremio, mais dans un terminal. En
`LOG_LEVEL=debug`, chaque requête sortante est tracée : on voit à quelle
étape la chaîne casse (domaine, recherche, rapprochement, extraction).

## Architecture

```
src/
  index.ts        manifest + /stream + /proxy + /health
  userconfig.ts   config par utilisateur, encodée dans l'URL
  configure.ts    page de génération du lien d'installation
  direct.ts       teste quels flux se passent du proxy
  debug.ts        moteur de diagnostic : une source à la fois, flux vérifiés
  debugpage.ts    page /debug
  livelog.ts      tampon d'événements + abonnés (console en direct)
  livepage.ts     page /debug/live
  trace.ts        capture des logs par exécution (AsyncLocalStorage)
  ratelimit.ts    limite par IP + plafond de flux simultanés
  tmdb.ts         id IMDb → id TMDB, titres, alias, épisode absolu
  match.ts        rapprochement titre ↔ résultat, avec seuil
  proxy.ts        proxy signé + réécriture HLS
  display.ts      nommage, tri, dédoublonnage des flux
  cache.ts        cache mémoire + déduplication des appels en vol
  extractors/     hébergeurs (VOE, Vidmoly, Sibnet, Lplayer, packer…)
  scrapers/       une source = un fichier
```

Un scraper ne connaît que `types.ts` : il reçoit une demande normalisée, il
rend des flux normalisés. Ajouter une source, c'est un fichier et une ligne
dans `scrapers/index.ts`.

### Ce que le portage a simplifié

Les modules Sora tournaient dans le sandbox JS de l'app, sans primitive
cryptographique ni contrôle des octets. Ils compensaient :

| Module Sora | Ici |
|---|---|
| AES-128-CBC réimplémenté en JS pur (~120 lignes) | `crypto.createDecipheriv` |
| Trois interprétations d'octets tentées + worker distant en secours | `await res.arrayBuffer()` |
| `searchResults` / `extractEpisodes` / `extractDetails` | supprimés : Stremio fournit l'identifiant |
| VOE recopié dans quatre modules | un seul `extractors/voe.ts` |

### Ce que le portage a compliqué

Une seule chose, mais elle est structurelle : **le rapprochement par titre**.
Sora partait d'une recherche utilisateur ; ici on part d'un identifiant. Pour
les sources non keyées TMDB (anime-sama, voir-anime, nakanime, purstream), il
faut retrouver la fiche à partir du titre.

Un mauvais rapprochement ne rend pas « rien » — il rend **le mauvais film**.
`match.ts` applique donc un score explicite et un seuil, et préfère ne rien
rendre plutôt que servir un voisin. Si une source rend zéro flux sur un titre
que vous savez présent, c'est le premier endroit à regarder (`LOG_LEVEL=debug`
affiche le score retenu).

## Résultats de validation

Mesures réelles, un film (Interstellar) et un épisode d'anime (L'Attaque des
Titans S1E1) :

| Source | Film live | Anime S1E1 | Film d'animation |
|---|---|---|---|
| Movix | 12 flux | 7 flux | 7 flux |
| Purstream | 1 flux + sous-titres | 1 flux | 1 flux |
| Nakanime | — (anime only) | 13 flux | 10 flux |
| Anime-Sama | — (anime only) | 9 flux | 6 flux |
| VoirAnime | — (anime only) | 4 flux | 7 flux |
| **Total après dédoublonnage** | **10 flux / 4,9 s** | **31 flux / 9,2 s** | — |

Film live : Interstellar. Anime : L'Attaque des Titans S1E1. Film d'animation :
Your Name. Les trois sources anime traitent les films comme les séries ;
mesures refaites sur *Le train de l'infini*, *Suzume* et *Le Voyage de
Chihiro*, chacune rendant des flux sur les trois sources.

Le rapprochement par titre a trouvé la bonne fiche du premier coup sur les
trois sources anime, sans ajustement de seuil.

### Films d'animation : ce qu'il a fallu en plus

Un film n'est pas un épisode numéro 1, et chaque site le range autrement :

- **anime-sama** le met dans un onglet de la fiche de la franchise. Un onglet
  par film quand il est nommé (« Film - Train de l'infini »), ou un seul
  onglet « Films » de dix-sept entrées nommées par `newSPF(...)` — l'ordre de
  ces noms est l'index dans `episodes.js`, c'est le seul moyen de savoir
  lequel des dix-sept est le bon.
- **voir-anime** publie la VF et la VOSTFR d'un même film sous **deux fiches
  distinctes** : n'en prendre qu'une perd la moitié des langues.
- **nakanime** annonce `format: MOVIE` — le seul des trois à le dire, ce qui
  évite de confondre un film avec la série du même nom.

Deux pièges communs, réglés dans `match.ts` : les moteurs de recherche de ces
sites travaillent sur la chaîne entière et ne digèrent pas un titre de film
complet (`franchiseRoot` cherche aussi « Demon Slayer » seul), et ces sites
préfixent le nom de la franchise au titre du film, ce qu'aucune distance
d'édition ne pardonne (`pickByKeywords` repêche sur les mots, avec un écart
minimal exigé entre les deux meilleurs candidats).

**Lecture de bout en bout** : master (1,6 Ko) → variante (321 Ko) → segment
(2,79 Mo de MPEG-TS), le tout à travers le proxy. L'hôte testé refuse la
requête sans User-Agent : la preuve que l'injection de headers fait son
travail.

### Premier démarrage

```bash
cp .env.example .env       # TMDB_API_KEY
npm install && npm test
npm run probe -- movie tt0816692
```

## Page de configuration — un lien par utilisateur

`https://votre-instance/configure` génère un lien d'installation personnel.
Une seule instance sert alors des réglages différents à chacun : la config est
encodée dans le chemin de l'URL (`/c/<config>/manifest.json`), ce qui est la
convention Stremio pour un addon configurable.

Ce que chacun règle pour lui :

| Réglage | Pourquoi ça compte |
|---|---|
| **Sa propre clé TMDB** | Le quota de l'hébergeur ne s'épuise pas, et une clé révoquée ne pénalise que son propriétaire. Formats v3 et v4 acceptés. |
| **Mode direct ou proxy** | Direct = zéro bande passante côté serveur, au prix des quelques flux qui exigent un `Referer`. |
| **Sources actives** | Moins de sources, réponse plus rapide. |
| **Langues, qualités, tri** | Ordre des langues par glisser-déposer, qualités exclues, qualité préférée. |
| **Réponse rapide dès N flux** | Voir plus bas — c'est le réglage qui change le plus le confort. |
| **Pseudo** | Apparaît dans les logs de l'hébergeur, pour rattacher un signalement à une config. |

`npm run build:static` en produit une version **autonome** : un fichier HTML
de 12 Ko, sans serveur derrière, où l'utilisateur saisit l'adresse de son
propre addon. Hébergeable gratuitement n'importe où — c'est l'option pour qui
ne veut rien faire tourner (voir [DEPLOIEMENT.md](DEPLOIEMENT.md), option D).

La page tourne entièrement dans le navigateur : rien n'est envoyé au serveur,
rien n'est stocké. La clé TMDB finit dans le lien de l'utilisateur, pas dans
une base chez l'hébergeur — et la page prévient qu'un tel lien ne se partage
pas.

L'URL sans configuration (`/manifest.json`) reste celle d'une instance
personnelle : elle montre tout, proxy compris.

### Réponse rapide

Une seule source lente bloque toute la réponse : mesuré, purstream a mis 25 s
là où quatre autres avaient déjà livré. Avec un seuil, l'addon rend la main dès
qu'il a de quoi remplir l'écran, et les retardataires continuent en
arrière-plan pour compléter le cache.

| | Flux | Délai |
|---|---|---|
| Attendre toutes les sources | 28 | 10,2 s |
| Seuil à 5 flux | 11 | **3,7 s** |
| Même épisode rejoué | 28 | 23 ms |

La troisième ligne est le point : on n'échange pas des flux contre de la
vitesse, on décale seulement leur arrivée.

## Héberger publiquement

Pour que d'autres installent l'addon avec une simple URL, il faut le faire
tourner sur une machine joignable, avec un domaine et du HTTPS.

Le parcours complet, du VPS vierge au lien partageable, est dans
[DEPLOIEMENT.md](DEPLOIEMENT.md) — avec deux variantes : depuis chez soi par
tunnel Cloudflare, et sur une plateforme gratuite en mode direct.

En résumé :

```bash
# sur un VPS, DNS du domaine pointé dessus, ports 80 et 443 ouverts
git clone -b gh-main-r2ievx https://github.com/MXFia19/module-sora
cd module-sora/stremio
cp .env.example .env          # TMDB_API_KEY + PROXY_SECRET
echo "PROBE_DIRECT=true" >> .env

ADDON_DOMAIN=sora.exemple.fr docker compose -f docker-compose.public.yml up -d --build
```

Caddy obtient le certificat tout seul. Vos utilisateurs vont ensuite sur
`https://sora.exemple.fr/configure`, règlent ce qu'ils veulent et repartent
avec leur propre lien d'installation. Le HTTPS rend aussi l'addon utilisable
depuis `web.stremio.com`, qui refuse le HTTP simple.

Conseillez-leur d'apporter leur clé TMDB et de laisser le mode « direct » :
votre quota et votre bande passante ne bougent alors pas.

### Le chiffre qui décide de tout : la bande passante

Un flux proxifié fait transiter **chaque octet de la vidéo par votre serveur**.
Un film de 2 h en 1080p ≈ **3,5 Go**, et dix spectateurs simultanés ≈ **40 Mbps
d'uplink en continu**. C'est ça qui coûte, pas le CPU.

D'où `PROBE_DIRECT=true`. L'addon teste chaque flux sans headers et ne
proxifie que ceux qui en ont réellement besoin :

| | Flux proxifiés | Servis en direct |
|---|---|---|
| Sans `PROBE_DIRECT` | 31 / 31 | 0 |
| Avec `PROBE_DIRECT` | 4 / 31 | **27 (87 %)** |

Les scrapers attachaient le `Referer` du site source à l'URL de lecture, alors
qu'il ne servait qu'à récupérer la page d'embed. Le CDN final, lui, ne le
réclame presque jamais — vérifié sur une dizaine d'hébergeurs. Les flux
directs ne coûtent alors rien d'autre qu'une réponse JSON.

Le verdict est mémorisé par hôte : ~3 s au premier appel pour un CDN inconnu,
puis rien. À langue et qualité égales, un flux direct est proposé avant un
flux proxifié.

Avec ça, un VPS d'entrée de gamme (~5 €/mois, 20 To de trafic) tient
confortablement. Sans, les 20 To partent en ~5 500 films.

### Garde-fous

Le `docker-compose.public.yml` les active avec des valeurs prudentes :

| Variable | Défaut public | Ce qu'elle protège |
|---|---|---|
| `RATE_LIMIT_STREAM_PER_MIN` | 20 / IP | Les sites sources. Trop d'appels et c'est **l'IP de votre serveur** qui se fait bannir chez eux, pas celle de l'utilisateur. |
| `PROXY_MAX_CONCURRENT` | 15 | Votre uplink. Au-delà, mieux vaut refuser proprement que dégrader la lecture de tout le monde. |
| `TRUST_PROXY` | 1 | Sans ça, toutes les requêtes semblent venir de Caddy et la limite par IP punit tout le monde d'un bloc. |

`PROXY_SECRET` devient obligatoire en public : sans lui, un redémarrage coupe
toutes les lectures en cours.

### Ce qu'il faut savoir avant de rendre ça public

- **Vous devenez l'intermédiaire.** En usage personnel, votre IP interroge les
  sites pour vous seul. En public, votre serveur le fait pour tout le monde :
  les sources peuvent bannir son IP, et le trafic vidéo proxifié sort de chez
  votre hébergeur sous votre nom.
- **Oracle Cloud Always Free** est l'exception parmi les offres gratuites :
  10 To/mois de trafic sortant, soit assez pour laisser le proxy actif. Ses
  pièges (pare-feu interne en plus des règles cloud, reprise des instances
  inactives) sont détaillés dans [DEPLOIEMENT.md](DEPLOIEMENT.md).
- **Vercel est exclu, et la plupart des PaaS avec.** Pas pour une question de
  durée — Vercel autorise 300 s de fonction même en Hobby, largement assez.
  Mais ses *Fair Use Guidelines* listent sous « Never fair use » : *Proxies*,
  *Media hosting for hot-linking* et *Scrapers*. Cet addon est les trois à la
  fois. S'y ajoute un problème technique : le cache est en mémoire du
  processus, donc inopérant en serverless — chaque requête rescrape les cinq
  sites depuis une IP de datacenter partagée, ce qui est le profil qui se fait
  bannir. Il faut une vraie VM.
- **Un lien proxifié signé reste valable 6 h** et peut être partagé hors de
  Stremio. `PROXY_TTL_MS` réduit la fenêtre si ça vous gêne.
- **Diffuser publiquement des liens vers des contenus protégés vous expose**
  bien plus qu'un usage privé, et l'exposition dépend de votre juridiction et
  de votre hébergeur. C'est une décision qui vous appartient ; ce README ne
  fait que la signaler.

## Limites connues

- **lulustream / luluvdo** : l'extraction est correcte (l'URL retenue est la
  seule présente dans la page), mais leur CDN a répondu 403 à toutes les
  requêtes du serveur de test, avec ou sans headers. À revérifier depuis votre
  propre hébergement : un blocage d'IP de datacenter est l'explication la plus
  probable.
- **Filemoon** n'est pas porté. Il exige une preuve de travail et une
  attestation signée, que les modules Sora délèguent à un Cloudflare Worker
  externe. Le module `voir-anime` le désactive déjà de son côté.
- **Cloudflare** : voir-anime sert parfois un défi anti-bot à un client
  serveur. Le scraper le détecte et le signale au lieu de conclure « aucun
  résultat ».
- **Pas de catalogue** : l'addon ne fournit que des flux. La navigation reste
  celle de Cinemeta.
- **Cache mémoire uniquement** : il repart à zéro au redémarrage, ce qui ne
  coûte qu'une poignée de requêtes.
- **Les flux ne sont pas testés avant d'être proposés** : un hébergeur mort
  apparaît quand même dans la liste. Les sonder doublerait le temps de
  réponse ; Stremio permet de passer au suivant d'un clic.

## Licence et usage

Ce code n'héberge aucun contenu : il agrège des liens accessibles
publiquement. Vérifiez la légalité de son usage dans votre juridiction.
