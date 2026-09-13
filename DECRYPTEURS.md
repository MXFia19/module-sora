# 🔐 Synthèse des décrypteurs / extracteurs — modules Sora

Référence centralisée de toute la crypto/déobfuscation présente dans les modules
(`sora tester/sources/<module>/`). Objectif : retrouver vite « quel module fait quoi »
et réutiliser une implémentation éprouvée au lieu de la réécrire.

> Légende statut : ✅ autonome & fiable · ⚠️ dépend d'un service externe ou cassé · 🔁 logique partagée (copiée dans plusieurs modules)

---

## 1. Filemoon  — PoW + AES-256-GCM + attest ECDSA
> ⚠️ **Périmé — voir la section 10 (Byse Frontend).** La plateforme s'est renommée et a
> retiré le PoW, le captcha et l'attestation ECDSA : un seul `GET /api/videos/<code>/`
> suffit désormais. Seule la sélection des `key_parts` par `version` reste exacte.
> `filemoon.sx` n'est plus qu'un domaine parmi d'autres de cette même application.

Le plus complexe. Flux : `embed/details → access/challenge → (worker ECDSA) access/attest → embed/captcha → PoW → captcha/verify → embed/playback → déchiffrement AES-GCM`.

- **Hash PoW** : hash maison style ChaCha (PAS SHA256). Préimage = `nonce + ":" + compteur`, on cherche `leadingZeroBits ≥ difficulty`.
- **Déchiffrement** : AES-256-GCM (via CTR, sans vérif du tag). Le champ `version` (1-20) sélectionne 2 vrais `key_parts` aux indices `[n, 31-n]` (le reste = leurres). Clé = concat des 2 parts.
- **attest** : signature ECDSA P-256 faite par le worker Cloudflare `filemoon-attest.kurzmathis4.workers.dev`.
- **Headers d'embed** : `X-Embed-Origin` (host nu), `X-Embed-Referer`, `X-Embed-Parent` (URL embed d'origine), `X-Captcha-Token` (le verifyToken).

| Module | Emplacement | Statut |
|---|---|---|
| **movix** | `filemoonExtractor` L1673 · `FileMoonDecryptor` L2008 · `_aesgcmDecrypt` L1956 · `solvePoW`/`solvePoWLocal` L287 | ✅ 100% local (AES-GCM + base64 pur-JS) ; PoW via worker `/pow` + fallback local budgété (2) |
| **nakanime** | `extractFilemoon` L724 · `_fmDecryptPlayback`/`_aesgcmDecrypt` L~775 · `_fmSolvePoW` · `_fmSelectParts` L741 | ✅ 100% local (v1.0.14), idem movix |
| **voir-anime** | `filemoonExtractor` L628 · `phpEndpoint = api.jm26.net` **L799** | ⚠️ **ANCIEN** : déchiffre encore via **jm26.net**, pas d'offload PoW worker. À migrer (copier le local de movix/nakanime). |

**Implémentation de référence** : movix `_aesgcmDecrypt` + `FileMoonDecryptor` (AES-GCM pur-JS validé 50/50 vs crypto.subtle). Worker `/pow` + `/attest` : `sora tester/filemoon-pow.worker.js`.

---

## 2. Embedseek / Neocine / Player4me  — AES-128-CBC (hex)
L'API renvoie un blob **hex** chiffré en AES-128-CBC.
- **Clé** = `kiemtienmua911ca` · **IV** = `1234567890oiuytr` (ASCII, 16 o chacun).
- Sortie = JSON `{ sources / file }`.

| Module | Emplacement | Statut |
|---|---|---|
| **movix** | `_AES` (CBC pur-JS) L867 · `embedseekDecrypt` L999 · `embedseekExtractor` L1015 | ✅ pur-JS (pas de crypto.subtle, compat WebOS/iOS) |
| **dessin-anime** | `player4meExtractor` L420 | ⚠️ **CASSÉ** : délègue à `http://localhost/decrypt.php` (placeholder dev). À remplacer par le `_AES.cbcDecrypt` de movix. |

**Implémentation de référence** : movix `_AES` + `embedseekDecrypt`.

---

## 3. VOE  — rot13 → base64 → shift(-3) → reverse  🔁
Chaîne de déobfuscation du JSON VOE : `rot13` sur le 1er élément → base64 decode → décalage `charCode-3` → `reverse()` → `JSON.parse`.

| Module | Emplacement |
|---|---|
| movix | `voeExtractor` L1550 |
| voir-anime | `voeExtractor` L828 + `voeBase64Decode` L882 |
| anime-ultra | `voeExtractor` L488 |
| anime-sama | `voeExtractor` L496 |

🔁 **Code identique copié dans 4 modules** → candidat n°1 à une éventuelle factorisation. Implémentation de référence : movix.

---

## 4. p.a.c.k.e.r  — unpacker `eval(function(p,a,c,k,e,d){...})`  🔁
Désassemble le packer Dean Edwards classique (regex `eval\(function\(p,a,c,k,e,d\)...split\('\|'\)\)\)`) sans `eval()`, en reconstruisant le dictionnaire base36.

| Module | Emplacement | Hosts visés |
|---|---|---|
| movix | dans `extractDirectVideo` L1287 · `vidhideExtractor` L1580 | vidhide, génériques |
| voir-anime | L709 · `vidhideExtractor` L897 | vidhide |
| dessin-anime | `mixdropExtractor` L446 · `vidhideExtractor` L503 | mixdrop, vidhide |
| anime-sama | `vidhideExtractor` L526 (L535) | vidhide |
| anime-ultra | `unpack` global, usage L352 | génériques |

🔁 Logique identique partout.

---

## 5. Doodstream / Dood  — pass_md5 token
Pas de "déchiffrement" mais une reconstruction d'URL signée : extraire `/pass_md5/...`, appeler l'endpoint → base URL, puis suffixe `~<randomString>?token=<token>&expiry=<timestamp>`.

| Module | Emplacement |
|---|---|
| movix | `doodstreamExtractor` L1608 (playmogo/doply/dood) |

---

## 6. nakanime  — API chiffrée XOR (clé dérivée)
Toutes les réponses API (search, sources) sont **XOR**ées.
- **Clé (32 o)** générée par `genererCleSecrete(apiRoute)` : `u = "nkapiv1" + apiRoute`, puis pour `k` de 0 à 31 : `m = Σ (m*31 + charCode + k) & 255`.
- Récupération des octets bruts via `text()` + `charCodeAt` (encodage `iso-8859-1` byte-identity pour ne pas corrompre le binaire sur iOS).

| Module | Emplacement |
|---|---|
| nakanime | `genererCleSecrete` L33 · fetch+XOR L67-120 |

---

## 7. cinepulse  — obfuscation des paramètres d'API
Pas pour le flux vidéo, mais pour construire les requêtes : décalage César des chiffres, **XOR avec la lettre `'k'`** (`s.charCodeAt ^ 'k'`), puis base64. Préfixes `c`/`t`/`s`/`e` selon le type.

| Module | Emplacement |
|---|---|
| cinepulse | L155-175 (XOR `'k'` L164) |

---

## 8. miruro  — base64 + pako (gzip)
Décodage base64 pur-JS (`pureAtob`/`pureBtoa`), `base64UrlEncode` pour signer les requêtes, et **décompression gzip via pako** (chargé depuis le CDN cloudflare).

| Module | Emplacement | Statut |
|---|---|---|
| miruro | `pureAtob` L62 · `base64UrlEncode` · `ensurePako`/pako L~90 | ⚠️ dépend du CDN externe `cdnjs…/pako` |

---

## 9. Utilitaire transverse — base64url 100% pur-JS  🔁
Décodeur base64url sans `atob` (l'`atob` d'iOS est inconstant : throw "Invalid base64" OU renvoie `undefined`). Table de chars + accumulation de bits.

| Module | Nom |
|---|---|
| movix | `FileMoonDecryptor.b64d` L2023 |
| nakanime | `_fmB64d` |
| miruro | `pureAtob` L62 |
| voir-anime | `voeBase64Decode` L882 (avec atob en 1er, fallback pur-JS) |

⚠️ **Préférer la version SANS atob** (movix/nakanime) : voir-anime/miruro tentent `atob` d'abord, ce qui peut échouer silencieusement sur l'app iOS.

---

## 🔗 Extracteurs de lien (par hôte)
Récupèrent l'URL de flux (.m3u8/.mp4) depuis la page d'embed. **Le piège est presque toujours les headers** : le player doit rejouer EXACTEMENT le `Referer`/`User-Agent`/`Accept-Language` utilisés au fetch, sinon le token du flux est rejeté (403). Implémentation modulaire de référence : **nakanime** (`extractVidmoly`/`extractSibnet`/… L191-316).

| Hôte | Technique | Headers / piège | Modules | Réf (nakanime) |
|---|---|---|---|---|
| **vidmoly** | regex `file:"…m3u8"` dans le HTML | Referer + Origin `vidmoly.biz` | movix, nakanime, anime-sama, anime-ultra, voir-anime | `extractVidmoly` L191 |
| **sibnet** | regex `src:"/v/…mp4"` | ⚠️ page en **windows-1251** (sinon `text()` casse sur iOS) ; Referer `video.sibnet.ru` | movix, nakanime, anime-sama, anime-ultra, voir-anime | `extractSibnet` L201 |
| **voe** | `voeExtractor` (rot13→b64→shift→reverse, cf. décrypteur #3) | Referer = origin de l'embed | movix, nakanime, anime-sama, anime-ultra, voir-anime | `extractVoe` L217 |
| **smoothpre** | dépack p.a.c.k.e.r → m3u8 | Referer `smoothpre.com` | nakanime | `extractSmoothpre` L231 |
| **sendvid** | meta `og:video:secure_url` / `var video_source` / `<source>` | ⚠️ **cert TLS intermédiaire expiré** côté serveur → fetch peut être rejeté (échec propre) ; Referer `sendvid.com` | nakanime, anime-sama, anime-ultra, voir-anime | `extractSendvid` L244 |
| **mail.ru / ok.ru** | endpoint meta `my.mail.ru/+/video/meta/{id}` → JSON `{videos:[{key,url}]}`, meilleure qualité | Referer `my.mail.ru` ; mp4 à tokens dans l'URL | nakanime | `extractMailru` L262 |
| **lulustream / luluvdoo** | dépack p.a.c.k.e.r → m3u8 | ⚠️ **403 sauf si Referer `luluvdo.com` + UA + `Accept-Language: fr-FR,fr;q=0.8` ENSEMBLE** ; le player doit rejouer les 3 | movix, nakanime, dessin-anime, voir-anime | `extractLulustream` L283 |
| **uqload** | regex `sources:["…mp4"]` / lien direct | Referer host ; détecte "video supprimée" (DMCA/404) | movix | (inline `extractDirectVideo`) |
| **hgcloud** (audinifer/huntrexus/vibuxer) | hop vers `vibuxer.com/e/{id}` → regex `hls2`/`hls3` | Referer = URL vibuxer | movix | (inline L1263) |
| **darkibox** | regex `…darkibox.com/…m3u8` (essaie plusieurs UA) | — | movix, cinepulse, nakios | (inline L1344) |
| **fsvid** | lien direct .m3u8 / dépack | ⚠️ **leurre** : la page pose `s1.fsvid.lol/troll/master.m3u8` en clair pour que la vraie URL, chiffrée, passe inaperçue — cf. partie II §11 | movix, cinepulse, nakios | (inline L1436) |
| **vidzy / minochinos** | « Universel » : lien direct .m3u8/.mp4 puis dépack p.a.c.k.e.r | ⚠️ vidzy est du **fsvid** (XOR + leurre `troll`) — le lien direct trouvé par recherche générique EST le leurre, cf. partie II §11 | movix, cinepulse, nakios | (inline L1528) |
| **doodstream** (playmogo/doply) | pass_md5 (cf. décrypteur #5) | Referer host | movix | `doodstreamExtractor` L1608 (movix) |
| **mixdrop** | dépack p.a.c.k.e.r → `vfile`/`wurl` | ⚠️ **périmé** : reCAPTCHA v3 devant la résolution depuis 2026 — le dépack ne suffit plus (cf. partie II, « murs infranchissables ») | dessin-anime | `mixdropExtractor` L446 (dessin-anime) |
| **vidhide** | dépack p.a.c.k.e.r → m3u8 | — | movix, voir-anime, dessin-anime, anime-sama | `vidhideExtractor` |
| **embedseek / player4me** | AES-128-CBC (cf. décrypteur #2) | — | movix ✅, dessin-anime ⚠️ | `extractEmbed4me` L648 (nakanime) |
| **filemoon** | PoW + AES-GCM (cf. décrypteur #1) | X-Embed-* + X-Captcha-Token | movix, nakanime, voir-anime | `extractFilemoon` L843 |
| **streamtape** | regex token `robotlink`/`videolink` reconstruit | Referer host | movix, anime-sama, voir-anime | (inline) |

**Helper transverse** : `unpackStream(html)` (nakanime) / dépack inline = le moteur p.a.c.k.e.r commun (décrypteur #4). `extractGeneric` (nakanime L298) = fallback lien direct + dépack pour les hosts non spécifiques.

> 🔑 Règle d'or des headers : **ce qui est envoyé au fetch DOIT être renvoyé dans `headers` du stream** (surtout luluvdoo, vidmoly, sibnet). Sinon le CDN renvoie 403.

---

## Modules SANS décrypteur (API/HTML en clair)
`aether`, `nakios`, `purstream`, `bingebox`, `livewatch`, `Nakastream`, `twitch-no-sub`, `anime-sama` (hors extracteurs d'hôtes ci-dessus) — JSON/HTML directs, juste du parsing.

---

## 🔧 À corriger (dette repérée pendant le scan)
1. **voir-anime → filemoon** : utilise encore `api.jm26.net` (L799) + pas d'offload PoW. Porter le filemoon local de movix/nakanime.
2. **dessin-anime → player4me** : pointe sur `http://localhost/decrypt.php` (cassé en prod). Remplacer par `_AES.cbcDecrypt` (AES-128-CBC, mêmes clé/IV qu'embedseek de movix — à confirmer).
3. **VOE** (×4) et **p.a.c.k.e.r** (×5) : logique dupliquée → factorisation possible si un jour on veut une lib commune (chaque module Sora doit rester un fichier autonome, donc factoriser = copier le même bloc canonique partout).

---
*Partie I générée le 2026-06-27. Réfs `file:Lxxx` indicatives (peuvent décaler après édition).*
*Corrections marquées ⚠️ ajoutées le 2026-09-13 — voir la partie II ci-dessous.*

---

# 📦 Partie II — Addon Stremio (`stremio/src/extractors/`)

Cette partie couvre le portage autonome (TypeScript, Node). Les techniques ci-dessous
ont été trouvées après la rédaction de la partie I ; **certaines la corrigent**, voir
les ⚠️ ci-dessous.

> **La leçon qui revient à chaque fois : reconnaître un hébergeur à SA PAGE, jamais à son
> domaine.** VOE, embedseek, Byse, fsvid et FireStream changent tous de nom de domaine ;
> aucun n'a changé la forme de sa page. Un aiguillage par `match: /nom\.tld/` est une
> course perdue d'avance, et il coûte des flux en silence.

---

## 10. Byse Frontend — ex-Filemoon  ⚠️ *corrige la section 1*

`filemoon.sx` n'est plus qu'un domaine parmi d'autres d'une plateforme qui se nomme
elle-même **Byse Frontend** : `bysebuho.com`, `bysesayeveum.com`, `gn1r5n.org`,
`lukefirst.lol`, `doply.net`… tous servent la MÊME application (même bundle, même API).
On la reconnaît à `<title>Byse Frontend</title>` dans une coquille de 1,6 Ko.

**Le PoW, le captcha et l'attestation ECDSA de la section 1 ne sont plus nécessaires.**
Un seul appel suffit :

    GET <origin>/api/videos/<code>/   ->  { playback: { iv, payload, key_parts[30], version } }

- **AES-256-GCM**, marqueur d'authenticité sur les 16 derniers octets de `payload`.
- Le champ `version` (1-20) désigne les DEUX vrais fragments aux indices `[n, 31-n]` ;
  les 28 autres sont des leurres. `version` change à chaque appel — **le lire, jamais
  le supposer**, c'est ce qui fait que ça marche deux fois de suite.
- Version hors bornes → le bundle d'origine retombe sur la totalité des fragments ;
  on fait pareil plutôt que d'échouer.
- Vidéo supprimée → `{"error":"video record missing: video not found"}`.

`stremio/src/extractors/byse.ts` · `keyParts()` / `decodeByse()` / `isBysePage()`

**Piège coûteux** : `kokoflix.lol/chamber_go.php?id=…` n'est qu'une **302** vers
`bysesayeveum.com/e/<code>`. Le client HTTP suit la redirection, mais si le code garde
l'URL de DÉPART, Byse cherche son code dans « chamber_go.php » et ne trouve rien —
quinze liens perdus par film. Toujours résoudre sur l'URL d'ARRIVÉE (`response.url`).

---

## 11. fsvid / vidzy — XOR à graine dérivée du hostname, avec leurre

    seed = Σ location.hostname.charCodeAt(i) & 255
    clair[i] = base64(payload).reverse()[i] ^ ((start + i*step + seed) & 255)

`start` et `step` sont écrits en clair dans la page (`(0x3d + i*89 + H) & 255`).

**Le leurre** : la page pose en clair `var _fsvHls = "https://s1.fsvid.lol/troll/master.m3u8"`.
Il s'appelle littéralement « troll ». Une recherche générique d'URL de média ramasse le
leurre et sert un flux mort. Le script lui-même y retombe si le déchiffrement échoue —
c'est ce qui arrive quand la page est servie depuis un autre domaine que celui attendu.

**Le décodage vaut identification** : il exige la charge utile ET les constantes du XOR,
et ne rend que ce qui commence par `http`. On l'essaie donc sur CHAQUE page plutôt que
d'aiguiller par domaine — `vidzy.org` sert tantôt un enrobage, tantôt le lecteur fsvid
lui-même, et l'aiguiller par son nom revenait à choisir la mauvaise moitié du temps.

`stremio/src/extractors/fsvid.ts` · `decodeFsvid(page, embedUrl)`

---

## 12. BlinkFlux — déchiffrement délégué au serveur

Indexé par **identifiant TMDB**, pas par code de fichier :
`/api/v1/index.php?route=movies/<tmdb>/player&api_key=<clé>`.

La page ne contient pas l'URL, même chiffrée — seulement un couple qu'on rend au serveur :

    POST /api/v1/index.php?route=unlock&api_key=<clé>
    { "token": "", "payload": ENCRYPTED_PAYLOAD, "iv": ENCRYPTED_IV }
    -> { "success": true, "url": "https://cdn78.vida-loka.store/movies/….mp4?ff=<expiry>.<hash>" }

- `token` vide : le champ anti-robot existe mais n'est pas activé, le navigateur n'envoie
  rien de plus que nous.
- Les `/` du payload sont **échappés à la mode JS** (`ox\/OjHb`) : les renvoyer tels quels
  fait refuser l'appel.
- La clé d'API est obligatoire mais voyage dans l'URL que movix nous donne — la relire
  plutôt que la coder en dur, elle appartient à movix et peut tourner.
- Le Referer n'est pas vérifié. MP4 progressif signé **4 h**, servi par Cloudflare et
  **non lié à l'IP** → lecture directe, sans proxy.

`stremio/src/extractors/blinkflux.ts`

---

## 13. VidSonic — hexadécimal coupé puis inversé

Obfuscation purement décorative, aucune clé, aucun appel réseau :

    '3032323464|6166373866|…|70747468'  ->  retirer les « | »  ->  hex vers texte  ->  reverse
    -> https://sfy-01-fr.vidsonic.net/secure/…/index.m3u8?server_id=3&expires=…&md5=…

**Piège de performance** : le motif de recherche doit rester PLAT
(`["']([0-9a-fA-F|]{80,4000})["']` puis validation en JS). Une alternance imbriquée
(`hex+(\|hex+)+`) fait repartir le moteur en arrière sur chaque longue suite
hexadécimale — quadratique sur une page de 700 Ko.

Manifeste HLS signé (`expires` + `md5`) mais **non lié à l'IP** (vérifié sur le manifeste
ET les segments depuis plusieurs adresses) → direct, sans proxy.

`stremio/src/extractors/vidsonic.ts`

---

## 14. xshotcok (clone hxfile) — base64 + XOR, avec fonctions leurres

Trois couches :

1. bloc **p.a.c.k.e.r** (décrypteur #4) ;
2. il ne contient qu'une charge utile base64 et quatre appels — mais les fonctions de
   déchiffrement écrites dans la page sont **vides** : `var _52ad59 = ""; var _2e625d = "";`
   Les vraies arrivent de **`/xher_ads.js`**, un nom choisi pour qu'un bloqueur de
   publicités le supprime ;
3. `decodeURIComponent(atob(payload))` puis **XOR à clé répétée** (`_0x3e68eb`).

**On n'exécute pas leur JS.** La clé se retrouve de deux façons, la première valide gagne :

- **(a)** l'obfuscateur nomme la variable d'après la valeur qu'elle reçoit —
  `var _0x3e68eb = _2e625d();`. Le NOM est la clé ;
- **(b)** attaque à clair connu : le clair commence toujours par le garde anti-iframe
  `\t(function() {\n\t\tvar targetDomains = ['https://` (46 caractères), ce qui suffit
  à reconstituer une clé de n'importe quelle longueur plausible.

Une clé n'est acceptée que si le clair obtenu porte une entrée `"file":"http…`.

Le jeton de redirection du CDN (`svrx-cdn.ctmp.world` → `…-df-1/video.mp4?t=…`) **paraît
lié à l'IP** → poser un Referer pour forcer le passage par le proxy, sinon la redirection
et le fichier partent d'adresses différentes.

`stremio/src/extractors/xshotcok.ts`

---

## 15. FireStream — jeton à usage unique, lié à l'IP

La page le dit en commentaire : *« no API call — URL never in page source »*. C'est vrai.

    <script id="token-blob" type="text/plain">DauVKi3MvvXc…==</script>
    POST <origin>/api/videos/<slug>/resolve   { "blob": "<jeton>" }
    -> { "signedVideoUrl": "…/video.m3u8?md5=…&expires=…", "signedVideoSdUrl": … }

- **Piège de reconnaissance** : `/api/videos/<slug>/resolve` n'existe NULLE PART dans la
  page, le chemin est concaténé morceau par morceau (`'/api/videos/' + slug + '/resolve'`).
  Chercher la chaîne entière ne trouve rien. On reconnaît la page **au jeton**, ce qui la
  suit aussi quand elle bascule de `firestream.to` sur `firestream.site`.
- Le jeton est **lié à l'IP** : la page et l'échange doivent partir de la même adresse,
  sinon `{"error":"Token bound to different IP"}`. Acquis depuis un serveur à adresse fixe.
- Le manifeste rendu, lui, n'est **pas** lié à l'IP → direct, sans proxy.
- La page expose aussi `isVpn` / `vpnOrg` (détection d'IP d'hébergeur) mais ne bloque que
  si le créateur a activé `blockVpn`.

`stremio/src/extractors/firestream.ts`

---

## 16. Vidara — POST simple

    POST <origin>/api/stream   { "filecode": "<code>", "device": "desktop" }
    -> { "streaming_url": "…" }

Rien de chiffré. `stremio/src/extractors/misc.ts` · `extractVidara`

---

## 17. hgcloud — rejeu sur miroirs

Coquille de moins de 1200 o (« Page is loading, please wait » + `/main.js` obfusqué) dont
le saut est calculé en JS illisible. Plutôt que de lire le `main.js`, on **rejoue
`/e/<id>` sur ses miroirs** : `vibuxer.com`, `audinifer.com`, `huntrexus.com`.

`stremio/src/extractors/hgcloud.ts`

---

## 🧱 Murs infranchissables sans navigateur

| Hôte | Mur | Constat |
|---|---|---|
| **mixdrop** | reCAPTCHA v3 | ⚠️ *corrige la section « mixdrop » de la partie I* : le dépack p.a.c.k.e.r ne suffit plus, l'URL ne s'obtient qu'en postant un jeton qu'aucun client sans navigateur ne produit |
| **emmmmbed** | Cloudflare Turnstile | — |
| **jilliandescribecompany** | attestation canvas/WebGL `__cherami` | — |
| **veev.to** | attestation canvas/WebGL dans un bundle de 740 Ko | jeton signé identifié (voir ci-dessous), chemin CDN non trouvé |
| **listeamed / sandratableother / vudeo / tipfly** | interstitiel publicitaire `cdn-fileserver.com`, servi selon l'ASN | le mur FingerprintJS a un repli `fp=-7` qu'on sait rejouer, mais la page derrière est encore un interstitiel |

**veev.to — état des lieux** (non terminé) : `window._vvto.fc` est un jeton compressé en
**LZW classique** (dictionnaire 8 bits, codes > 255 émis tels quels — d'où les `ā ĉ Ā Ğ Ĭ ċ`).
Décompressé, il donne `<A>-<B>-<code>-<C>-<expires>-<md5>`, p. ex.
`3100210201-160-1naj1s8yj8im-79-1789314332-89772a99b05149b56066f7e1f37d7fdc`.
Le CDN est déduisible du poster (`s-gb-102760.veevcdn.co/i/01/00525/<code>.jpg`), mais le
chemin du manifeste ne suit aucune des conventions XFileSharing essayées (toutes en 404).
Les deux premiers `fc` de la page sont des leurres, dont un signé `Gujal00_loving_them_moves_buddy`.

---

## 🩺 Diagnostic : ne pas confondre « on ne sait pas lire » et « il n'y a rien à lire »

Un fichier supprimé et un hébergeur inconnu produisaient le même « rien extrait », ce qui
a coûté des heures à chercher des bugs inexistants. L'addon relaie désormais la phrase de
l'hébergeur telle quelle :

- `File is no longer available as it expired or has been deleted` (famille callistanise :
  luluvdo, minochinos, bingezove, smoothpre)
- `No such file` (StreamHG : wishonly, dhtpre)
- `Video not found or deleted` (embedseek)
- `video record missing: video not found` (Byse)
- `This domain is for sale` (oneupload, ups2up — le service est mort)
- le statut HTTP quand le corps n'est pas une page (`403` IP d'hébergeur, `404`/`410`
  supprimé, `502`/`520` hébergeur tombé)

Mesuré sur 166 liens tirés de 19 films et séries : **21 pages diagnostiquées nommément**
au lieu d'un « rien extrait » indifférencié.

---

## 📌 Règles apprises (partie II)

1. **Reconnaître par la page, pas par le domaine.** Vaut pour VOE, embedseek, Byse, fsvid,
   FireStream, BlinkFlux.
2. **Résoudre sur l'URL d'arrivée**, pas de départ — mais `fetch` efface le fragment, et
   toute la famille embedseek porte l'identifiant APRÈS le dièse (`bll.embedseek.com/#6fvwj`).
   N'adopter l'URL rendue que si elle désigne vraiment une autre page.
3. **Un extracteur nommé qui rend zéro n'est pas le dernier mot** : réessayer le chemin
   générique rattrape les variantes de page et produit le diagnostic.
4. **Un jeton signé n'est pas forcément lié à l'IP** — et l'inverse non plus. Le vérifier
   avant de décider de proxifier : proxifier pour rien, c'est relayer chaque octet de
   vidéo sans rien apporter.
5. **Ne jamais conclure « bloqué » depuis une adresse qui change** : les 403 constatés
   depuis un bac à sable à IP tournante ne se reproduisent pas forcément sur un serveur à
   adresse fixe. Vérifié deux fois dans le mauvais sens.

---
*Partie II générée le 2026-09-13 — addon Stremio, 104 tests. Les mécanismes, pas les numéros de ligne : le code bouge.*
