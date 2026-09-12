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

| Source | Film | Anime S1E1 |
|---|---|---|
| Movix | 12 flux | 7 flux |
| Purstream | 1 flux + sous-titres | 1 flux |
| Nakanime | — (anime only) | 13 flux |
| Anime-Sama | — (anime only) | 9 flux |
| VoirAnime | — (anime only) | 4 flux |
| **Total après dédoublonnage** | **10 flux / 4,9 s** | **31 flux / 9,2 s** |

Le rapprochement par titre a trouvé la bonne fiche du premier coup sur les
trois sources anime, sans ajustement de seuil.

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
