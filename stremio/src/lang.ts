/** Codes de langue. Stremio attend de l'ISO 639-2 (trois lettres) pour les
 *  sous-titres : un code à deux lettres s'affiche en libellé vide dans la
 *  liste, ce qui donne un menu de pistes anonymes. */

const TO_639_2: Record<string, string> = {
  fr: 'fre', fra: 'fre', fre: 'fre', french: 'fre', francais: 'fre', vf: 'fre',
  en: 'eng', eng: 'eng', english: 'eng', anglais: 'eng',
  es: 'spa', spa: 'spa', spanish: 'spa', espagnol: 'spa',
  de: 'ger', ger: 'ger', deu: 'ger', german: 'ger', allemand: 'ger',
  it: 'ita', ita: 'ita', italian: 'ita', italien: 'ita',
  pt: 'por', por: 'por', portuguese: 'por',
  ja: 'jpn', jp: 'jpn', jpn: 'jpn', japanese: 'jpn', japonais: 'jpn',
  ko: 'kor', kor: 'kor', korean: 'kor',
  zh: 'chi', chi: 'chi', zho: 'chi', chinese: 'chi',
  ar: 'ara', ara: 'ara', arabic: 'ara',
  ru: 'rus', rus: 'rus', russian: 'rus',
  nl: 'dut', dut: 'dut', nld: 'dut',
  pl: 'pol', pol: 'pol',
  tr: 'tur', tur: 'tur',
};

/** Normalise un code ou un nom de langue vers l'ISO 639-2.
 *  'fr-FR' -> 'fre', 'Français (Forcé)' -> 'fre', inconnu -> tel quel. */
export function toIso639_2(input: string): string {
  const raw = (input || '').trim().toLowerCase();
  if (!raw) return 'und';

  // 'fr-FR', 'pt_BR' -> on ne garde que la partie langue.
  const base = raw.split(/[-_]/)[0]!;
  if (TO_639_2[base]) return TO_639_2[base];

  // Libellés en toutes lettres : on cherche un mot connu dedans.
  const normalized = raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [key, value] of Object.entries(TO_639_2)) {
    if (key.length > 3 && normalized.includes(key)) return value;
  }
  return base.slice(0, 3);
}

/** Une piste forcée ne traduit que les panneaux et les dialogues étrangers.
 *  On la garde, mais elle ne doit jamais être proposée comme piste par défaut. */
export function isForced(label: string): boolean {
  return /forc(e|é|ed)/i.test(label || '');
}

/** Déduit la langue audio annoncée par un libellé de source française.
 *  Sert au tri et à l'affichage, pas à la lecture. */
export function audioLabel(text: string): string {
  const t = (text || '').toLowerCase();
  if (/\bmulti\b/.test(t)) return 'MULTI';
  if (/\b(vostfr|vost|sub\s*fr)\b/.test(t)) return 'VOSTFR';
  if (/\b(vf|truefrench|french|fr)\b/.test(t)) return 'VF';
  if (/\bvo\b/.test(t)) return 'VO';
  return 'VF';
}
