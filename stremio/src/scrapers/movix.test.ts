import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecarte } from './movix';

test('on n’écarte que ce qui ne peut pas marcher', () => {
  assert.match(ecarte('https://veev.to/e/y789aduzdq78') ?? '', /canvas/);
  assert.match(ecarte('https://listeamed.net/e/27BaOnaYl00EMDX') ?? '', /publicitaire/);
  assert.match(ecarte('https://www.fembed.com/v/ITUSbqa1V9TP') ?? '', /ne répond plus/);
});

test('un hôte devenu lisible ne doit plus être écarté', () => {
  // Régression : ces deux-là ont été jetés en silence alors que VOE, Byse et
  // embedseek savaient les lire — deux flux perdus par film, sans un log.
  assert.equal(ecarte('https://kakaflix.lol/voe1//newPlayer.php?id=c227c61c'), null);
  assert.equal(ecarte('https://kakaflix.lol/moon2//newPlayer.php?id=ca3a1955'), null);
  assert.equal(ecarte('https://coflix.upn.one/#eusjum'), null);
  // Un hôte simplement tombé ou bloqué par IP garde sa chance : le diagnostic
  // dira pourquoi, et il remarchera peut-être depuis une autre adresse.
  assert.equal(ecarte('https://up4fun.top/e/abc'), null);
  assert.equal(ecarte('https://waaw.to/f/0LjHYyWiE1EK'), null);
});

test('les motifs ne débordent pas sur des hôtes voisins', () => {
  assert.equal(ecarte('https://ansembed.net/embed-tu80oqm76nwd.html'), null);
  assert.equal(ecarte('https://vidmoly.net/embed-8itfk2l4rv9q.html'), null);
  assert.equal(ecarte('https://static.veevcdn.co/assets/x.js'), null);
});

import { probes, LinkSet } from './movix';
import type { MediaRequest } from '../types';

const film: MediaRequest = {
  type: 'movie', tmdbId: '372058', title: 'Your Name.', year: 2016, aliases: [], anime: true,
};
const serie: MediaRequest = {
  type: 'series', tmdbId: '93405', title: 'Squid Game', year: 2021, aliases: [], anime: false,
  season: 1, episode: 1,
};

function urlDe(nom: string, req: MediaRequest, movixId: string | null = '123849'): string | null {
  return probes('movix.men', req, movixId).find(p => p.name === nom)!.url();
}

test('la sonde Direct interroge /api/films, pas /api/movies', () => {
  // Régression : l'API monte cette route sous « films ». Avec « movies »,
  // la sonde répondait 404 sur chaque film, en silence.
  assert.equal(urlDe('Direct', film), 'https://api.movix.men/api/films/download/123849');
  assert.equal(urlDe('Direct', serie),
    'https://api.movix.men/api/series/download/123849/season/1/episode/1');
  assert.equal(urlDe('Direct', film, null), null, 'sans identifiant interne, pas de sonde');
});

test('KissKH et Voirdrama visent les routes de l’API', () => {
  assert.equal(urlDe('KissKH', film), 'https://api.movix.men/api/kisskh/movie/372058');
  assert.equal(urlDe('KissKH', serie), 'https://api.movix.men/api/kisskh/tv/93405?season=1&episode=1');
  assert.equal(urlDe('Voirdrama', serie), 'https://api.movix.men/api/drama/tv/93405?season=1&episode=1');
  // Voirdrama ne connaît que les séries : inutile de l'interroger pour un film.
  assert.equal(urlDe('Voirdrama', film), null);
});

test('KissKH rend un flux prêt et ses sous-titres, pas un lien de lecteur', () => {
  const out = new LinkSet();
  probes('movix.men', film, null).find(p => p.name === 'KissKH')!.collect({
    sources: [{ label: 'KissKH', type: 'hls', url: 'https://cdn.invalid/hls/ep.1.m3u8' }],
    subtitles: [
      { lang: 'en', label: 'English', proxyUrl: 'https://sub.invalid/a.srt' },
      { lang: 'fr', label: 'French', sourceUrl: 'https://sub.invalid/b.srt' },
      { lang: 'id', label: 'Indonesia', proxyUrl: 'pas-une-url' },
    ],
  }, out);

  assert.equal(out.links.length, 0, 'rien à extraire : le flux est déjà jouable');
  assert.equal(out.ready.length, 1);
  assert.equal(out.ready[0]!.container, 'hls');
  assert.equal(out.ready[0]!.subtitles?.length, 2, 'la piste sans URL valide est écartée');
  assert.equal(out.ready[0]!.subtitles?.[0]!.lang, 'eng', 'ISO 639-2, sinon Stremio affiche un libellé vide');
});

test('Voirdrama rend des liens de lecteur ordinaires', () => {
  const out = new LinkSet();
  probes('movix.men', serie, null).find(p => p.name === 'Voirdrama')!.collect({
    data: [
      { name: 'Vidmoly', link: 'https://voembed.net/embed-dj4kks8zxxq6.html' },
      { name: 'Voe', link: 'https://voe.sx/e/uv7l87jcy00j' },
      { name: 'Cassé', link: null },
    ],
  }, out);
  assert.equal(out.links.length, 2);
  assert.equal(out.links[0]!.via, 'voirdrama');
});
