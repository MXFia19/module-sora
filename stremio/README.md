# Sora — addon Stremio

Portage autonome des modules Sora vers Stremio. Cinq sources françaises :
**movix**, **purstream**, **anime-sama**, **voir-anime**, **nakanime**.

Projet indépendant : pas de fork à resynchroniser, pas de SDK non maintenu.
Un serveur Node + TypeScript, un conteneur, aucune base de données.

> ⚠️ Les scrapers de ce dépôt **n'ont pas encore été exécutés contre les sites
> réels** : ils ont été écrits dans un environnement sans accès sortant. La
> logique hors réseau est couverte par des tests ; le reste demande une passe
> de validation (voir « Première mise en route »).

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

## Première mise en route

Dans l'ordre, du plus simple au plus fragile :

1. `npm test` — la logique hors réseau (29 tests).
2. `npm run probe -- movie tt0816692 --only movix` — movix est keyé TMDB, donc
   sans rapprochement par titre : si ça marche, la chaîne TMDB → source →
   extraction → proxy est bonne.
3. `--only purstream`, puis les trois sources anime, qui dépendent du
   rapprochement par titre et demanderont sans doute un ajustement du seuil
   dans `match.ts`.
4. Lecture réelle dans Stremio : c'est là que se voient les headers manquants.

## Limites connues

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

## Licence et usage

Ce code n'héberge aucun contenu : il agrège des liens accessibles
publiquement. Vérifiez la légalité de son usage dans votre juridiction.
