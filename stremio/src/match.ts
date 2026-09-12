/** Rapprochement titre <-> résultat de recherche.
 *
 *  C'est le point faible structurel du portage : Stremio donne un identifiant,
 *  les sources non keyées TMDB (anime-sama, voiranime, nakanime, purstream)
 *  ne savent chercher que par titre. Un mauvais rapprochement ne rend pas
 *  « rien » — il rend LE MAUVAIS FILM, ce qui est bien pire. D'où un score
 *  explicite et un seuil, plutôt qu'un `includes()`. */

/** Minuscule, sans accents, sans ponctuation, espaces normalisés.
 *  'Démon Slayer : Le Train' -> 'demon slayer le train' */
export function normalize(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Retire le bruit propre aux sites de streaming : mentions de langue, de
 *  qualité, de saison, et l'année entre parenthèses. */
export function stripNoise(s: string): string {
  return normalize(s)
    .replace(/\b(vf|vostfr|vo|multi|french|truefrench|subfrench|hd|fhd|4k|1080p|720p|480p|web dl|webrip|bluray|bdrip|hdlight)\b/g, ' ')
    .replace(/\b(saison|season|s)\s*\d+\b/g, ' ')
    .replace(/\b(episode|ep)\s*\d+\b/g, ' ')
    .replace(/\b(streaming|complet|vf et vostfr|en ligne|gratuit)\b/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Distance de Levenshtein, bornée en mémoire par deux lignes. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

/** Similarité 0..1 entre deux titres déjà normalisés. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / max;
}

/** L'un des deux titres contient-il l'autre *de façon significative* ?
 *
 *  La contenance brute est un piège : « Yaiba » est inclus dans « Demon Slayer
 *  -Kimetsu no Yaiba- The Movie: Mugen Train », et suffisait à faire passer la
 *  fiche d'un tout autre anime à 0.92. On n'accepte donc que deux formes de
 *  contenance défendables :
 *    - un préfixe sur frontière de mot (« Demon Slayer » dans « Demon Slayer -
 *      Le Film : Le train de l'infini »), qui est la façon dont un site nomme
 *      une déclinaison d'une œuvre ;
 *    - une inclusion qui couvre l'essentiel du titre le plus long (>= 60 %),
 *      où le reste ne peut être que du sous-titre.
 *  Un mot noyé au milieu d'un titre bien plus long n'est ni l'un ni l'autre. */
function contains(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short || !long.includes(short)) return false;
  const prefix = long.startsWith(short) && (long.length === short.length || long[short.length] === ' ');
  return prefix || short.length / long.length >= 0.6;
}

/** Racine de franchise d'un titre de film : « Demon Slayer - Le Film : Le
 *  train de l'infini » -> « Demon Slayer », « One Piece Film: Strong World »
 *  -> « One Piece ».
 *
 *  Les moteurs de recherche des sites travaillent sur la chaîne entière : leur
 *  donner le titre complet d'un film ne rend pas la fiche de la franchise mais
 *  cinq résultats sans rapport. Or c'est la fiche de la franchise qui porte
 *  l'onglet du film. Rend null quand il n'y a rien à raccourcir. */
export function franchiseRoot(title: string): string | null {
  const cut = title.split(/\s*:|\s[-–—]/)[0]?.trim() ?? '';
  const root = cut.replace(/\s+(le\s+)?(film|movie)s?\.?$/i, '').trim();
  if (!root || root.length < 4 || root.length === title.trim().length) return null;
  return root;
}

export interface Candidate {
  /** Titre tel qu'affiché par la source. */
  title: string;
  /** Année annoncée par la source, si elle en donne une. */
  year?: number;
  /** Titres supplémentaires côté source (titre original, alias). */
  extraTitles?: string[];
}

export interface ScoreOptions {
  /** Tous les titres connus du contenu cherché (TMDB : FR, EN, original, alias). */
  aliases: string[];
  year?: number;
  /** Score minimal pour accepter. 0.82 laisse passer la ponctuation et les
   *  articles qui sautent, mais pas un film voisin. */
  threshold?: number;
}

export interface Scored<T> {
  item: T;
  score: number;
  matchedOn: string;
}

/** Score un candidat contre l'ensemble des titres connus.
 *  L'année, quand les deux côtés la donnent, corrige : +0.05 si elle colle,
 *  pénalité forte si elle est franchement différente (remakes, sagas). */
export function scoreCandidate(candidate: Candidate, opts: ScoreOptions): Scored<Candidate> {
  const theirs = [candidate.title, ...(candidate.extraTitles ?? [])]
    .filter(Boolean)
    .map(stripNoise)
    .filter(Boolean);

  let best = 0;
  let matchedOn = '';

  for (const alias of opts.aliases) {
    const mine = stripNoise(alias);
    if (!mine) continue;
    for (const t of theirs) {
      let s = similarity(mine, t);
      // Un titre source qui contient exactement le titre cherché (« Dune
      // (2021) streaming vf ») ne doit pas être puni par sa longueur.
      if (s < 1 && contains(mine, t)) s = Math.max(s, 0.92);
      if (s > best) { best = s; matchedOn = alias; }
    }
  }

  if (opts.year && candidate.year) {
    const delta = Math.abs(opts.year - candidate.year);
    if (delta === 0) best = Math.min(1, best + 0.05);
    else if (delta > 1) best -= 0.25;
  }

  return { item: candidate, score: best, matchedOn };
}

/** Meilleur candidat au-dessus du seuil, ou null. */
export function pickBest<T extends Candidate>(
  candidates: T[],
  opts: ScoreOptions,
): Scored<T> | null {
  const threshold = opts.threshold ?? 0.82;
  let best: Scored<T> | null = null;

  for (const c of candidates) {
    const { score, matchedOn } = scoreCandidate(c, opts);
    if (!best || score > best.score) best = { item: c, score, matchedOn };
  }

  if (!best || best.score < threshold) return null;
  return best;
}

/** Mots qui ne distinguent rien : ils reviennent dans tous les titres d'une
 *  même franchise, et dans la moitié des titres de films en général. */
const FILLER = new Set([
  'film', 'films', 'movie', 'the', 'le', 'la', 'les', 'l', 'de', 'du', 'des', 'd',
  'un', 'une', 'et', 'and', 'of', 'a', 'an', 'partie', 'part', 'no',
]);

/** Mots distinctifs d'un titre, dédoublonnés. */
export function keywords(title: string): string[] {
  return [...new Set(stripNoise(title).split(' ').filter(w => w && !FILLER.has(w)))];
}

/** Part des mots distinctifs d'un titre qu'on retrouve dans l'un des titres
 *  connus. C'est l'inverse d'une distance d'édition, et c'est ce qu'il faut
 *  quand la source préfixe le nom de la franchise : « Demon Slayer : Kimetsu
 *  no Yaiba - Le film : Le train de l'Infini » est à 0.70 de similarité du
 *  titre TMDB « Demon Slayer - Le Film : Le train de l'infini », donc rejeté,
 *  alors que chacun de ses mots est présent dans les titres connus. */
export function coverage(title: string, aliases: string[]): number {
  const words = keywords(title);
  if (words.length === 0) return 0;

  let best = 0;
  for (const alias of aliases) {
    const theirs = new Set(keywords(alias));
    const hit = words.filter(w => theirs.has(w)).length / words.length;
    if (hit > best) best = hit;
  }
  return best;
}

/** Repêchage par mots-clés, à n'employer QUE lorsque `pickBest` n'a rien
 *  trouvé : il accepte des titres qu'une distance d'édition rejette.
 *
 *  Deux garde-fous, parce qu'un critère plus permissif est aussi plus prompt à
 *  rendre le mauvais film : la couverture doit être quasi totale, et le
 *  vainqueur doit devancer nettement le suivant. Deux candidats aussi bien
 *  couverts l'un que l'autre, c'est qu'aucun mot ne les sépare — on préfère
 *  alors ne rien rendre. */
export function pickByKeywords<T extends Candidate>(
  candidates: T[],
  aliases: string[],
  { min = 0.8, margin = 0.15 } = {},
): Scored<T> | null {
  const scored = candidates
    .map(c => ({ item: c, score: coverage(c.title, aliases), matchedOn: '' }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < min) return null;
  if (scored[1] && best.score - scored[1].score < margin) return null;
  return best;
}
