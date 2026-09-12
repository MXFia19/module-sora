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
      if (s < 1 && (t.includes(mine) || mine.includes(t))) {
        s = Math.max(s, 0.92);
      }
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
