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

test('les lecteurs « Omega » (emmmmbed, Turnstile) sont écartés, sans déborder', () => {
  assert.match(ecarte('https://emmmmbed.com/embed/CKcaH9As?t=eyJ') ?? '', /Turnstile/);
  assert.equal(ecarte('https://embed.example/embed/x'), null);
});

test('1jour1film, SwiftFlow et IMDB ont désormais leur variante film ET série', () => {
  // Relevé sur les pages de lecture du site (2026-11-15).
  assert.equal(urlDe('1jour1film', film), 'https://api.movix.men/api/j1f/movie/372058');
  assert.equal(urlDe('1jour1film', serie), 'https://api.movix.men/api/j1f/tv/93405/season/1');
  assert.equal(urlDe('SwiftFlow', film), 'https://api.movix.men/api/swiftflow/movie/372058');
  assert.equal(urlDe('SwiftFlow', serie), 'https://api.movix.men/api/swiftflow/tv/93405/season/1');
  assert.equal(urlDe('IMDB', film), 'https://api.movix.men/api/imdb/movie/372058');
  assert.equal(urlDe('IMDB', serie), 'https://api.movix.men/api/imdb/tv/93405');
});

test('SwiftFlow série : on prend l’épisode demandé, pas toute la saison', () => {
  const out = new LinkSet();
  probes('movix.men', { ...serie, episode: 2 }, null).find(p => p.name === 'SwiftFlow')!.collect({
    episodes: {
      '1': { vf: [{ url: 'https://blinkflux.lol/api/v1/index.php?route=series/93405/1/1' }], vostfr: [] },
      '2': {
        vf: [{ url: 'https://blinkflux.lol/api/v1/index.php?route=series/93405/1/2' }],
        vostfr: [{ url: 'https://blinkflux.lol/api/v1/index.php?route=series/93405/1/2/vo' }],
      },
    },
  }, out);
  assert.deepEqual(out.links.map(l => l.url), [
    'https://blinkflux.lol/api/v1/index.php?route=series/93405/1/2',
    'https://blinkflux.lol/api/v1/index.php?route=series/93405/1/2/vo',
  ]);
  assert.deepEqual(out.links.map(l => l.language), ['VF', 'VOSTFR']);
  assert.equal(out.links[0]!.via, 'swiftflow');
});

test('SwiftFlow film : players { vf, vostfr }', () => {
  const out = new LinkSet();
  probes('movix.men', film, null).find(p => p.name === 'SwiftFlow')!.collect({
    players: { vf: [{ url: 'https://blinkflux.lol/api/v1/index.php?route=movies/372058' }], vostfr: [] },
  }, out);
  assert.equal(out.links.length, 1);
  assert.equal(out.links[0]!.language, 'VF');
});

test('IMDB film : player_links[{ player, link, is_hd }]', () => {
  const out = new LinkSet();
  probes('movix.men', film, null).find(p => p.name === 'IMDB')!.collect({
    iframe_src: 'https://frvideosrc.co/film/372058',
    player_links: [
      { player: 'Dropload', link: 'https://dr0pstream.com/e/wky445ukd1fl', is_hd: true },
      { player: 'Doodstream', link: 'https://doodstream.com/e/8341ketrdptv', is_hd: false },
      { player: 'Cassé', link: null },
    ],
  }, out);
  // iframe_src n'est pas relevé : agrégateur illisible, il ne ferait qu'un échec de plus.
  assert.deepEqual(out.links.map(l => l.url), [
    'https://dr0pstream.com/e/wky445ukd1fl',
    'https://doodstream.com/e/8341ketrdptv',
  ]);
  assert.equal(out.links[0]!.via, 'imdb');
});

test('IMDB série : la forme historique reste lue', () => {
  const out = new LinkSet();
  probes('movix.men', serie, null).find(p => p.name === 'IMDB')!.collect({
    series: [{ seasons: [{ number: 1, episodes: [{ number: 1, versions: { VF: { players: [{ link: 'https://voe.sx/e/abc' }] } } }] }] }],
  }, out);
  assert.deepEqual(out.links.map(l => l.url), ['https://voe.sx/e/abc']);
});
