# 🔐 Synthèse des décrypteurs / extracteurs — modules Sora

Référence centralisée de toute la crypto/déobfuscation présente dans les modules
(`sora tester/sources/<module>/`). Objectif : retrouver vite « quel module fait quoi »
et réutiliser une implémentation éprouvée au lieu de la réécrire.

> Légende statut : ✅ autonome & fiable · ⚠️ dépend d'un service externe ou cassé · 🔁 logique partagée (copiée dans plusieurs modules)

---

## 1. Filemoon  — PoW + AES-256-GCM + attest ECDSA
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
| **fsvid** | lien direct .m3u8 / dépack | Referer parent | movix, cinepulse, nakios | (inline L1436) |
| **vidzy / minochinos** | « Universel » : lien direct .m3u8/.mp4 puis dépack p.a.c.k.e.r | Referer parent | movix, cinepulse, nakios | (inline L1528) |
| **doodstream** (playmogo/doply) | pass_md5 (cf. décrypteur #5) | Referer host | movix | `doodstreamExtractor` L1608 (movix) |
| **mixdrop** | dépack p.a.c.k.e.r → `vfile`/`wurl` | — | dessin-anime | `mixdropExtractor` L446 (dessin-anime) |
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
*Généré le 2026-06-27. Réfs `file:Lxxx` indicatives (peuvent décaler après édition).*
