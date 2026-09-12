import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeConfig, decodeConfig, applyConfig, DEFAULT_CONFIG } from './userconfig';
import type { UserConfig } from './userconfig';
import type { RawStream } from './types';

function stream(p: Partial<RawStream>): RawStream {
  return { url: 'https://cdn.test/a.m3u8', quality: 'HD', language: 'VF', server: 's', ...p };
}

const PROXIED = { Referer: 'https://host.test/' };

test('un aller-retour d’encodage préserve la configuration', () => {
  const c: UserConfig = {
    tmdbKey: 'abcdef0123456789abcdef0123456789',
    mode: 'direct',
    sources: ['movix', 'purstream'],
    languages: ['VF', 'MULTI'],
    qualities: ['1080p', '720p'],
    preferredQuality: '1080p',
    sort: 'quality',
    fallback: 'strict',
    minStreams: 5,
    nickname: 'quelquun',
  };
  assert.deepEqual(decodeConfig(encodeConfig(c)), c);
});

test('une config absente ou illisible retombe sur les défauts', () => {
  // Un lien tronqué par un client de messagerie ne doit pas casser
  // l'installation : mieux vaut des réglages par défaut qu'une erreur.
  assert.deepEqual(decodeConfig(undefined), DEFAULT_CONFIG);
  assert.deepEqual(decodeConfig('pas-du-base64-!!'), DEFAULT_CONFIG);
  assert.deepEqual(decodeConfig(Buffer.from('{cassé').toString('base64url')), DEFAULT_CONFIG);
});

test('l’URL sans configuration montre tout, proxy compris', () => {
  // Comportement d'une instance personnelle : ne rien cacher par défaut.
  assert.equal(DEFAULT_CONFIG.mode, 'proxy');
  assert.equal(DEFAULT_CONFIG.minStreams, 0);
});

test('le mode direct écarte les flux qui exigeraient le proxy', () => {
  const streams = [
    stream({ server: 'direct' }),
    stream({ server: 'proxifié', headers: PROXIED }),
  ];
  const out = applyConfig(streams, { ...DEFAULT_CONFIG, mode: 'direct' });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.server, 'direct');
});

test('le mode proxy garde les deux', () => {
  const streams = [stream({}), stream({ url: 'https://b.test/b.m3u8', headers: PROXIED })];
  assert.equal(applyConfig(streams, DEFAULT_CONFIG).length, 2);
});

test('les qualités et langues exclues sont filtrées', () => {
  const streams = [
    stream({ quality: '360p', language: 'VF' }),
    stream({ quality: '1080p', language: 'VO' }),
    stream({ quality: '1080p', language: 'VF' }),
  ];
  const out = applyConfig(streams, {
    ...DEFAULT_CONFIG, qualities: ['1080p', '720p'], languages: ['VF'],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.quality, '1080p');
  assert.equal(out[0]!.language, 'VF');
});

test('le repli souple relâche la langue mais GARDE les exclusions de qualité', () => {
  // Le point important : quelqu'un qui a exclu le 360p ne veut pas le voir
  // revenir au prétexte qu'il n'y a rien d'autre — alors qu'une langue
  // inattendue reste regardable.
  const streams = [
    stream({ quality: '360p', language: 'VF' }),
    stream({ quality: '1080p', language: 'VO' }),
  ];
  const out = applyConfig(streams, {
    ...DEFAULT_CONFIG, qualities: ['1080p'], languages: ['VF'], fallback: 'souple',
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.quality, '1080p', 'le 360p exclu ne doit jamais revenir');
});

test('le repli strict ne montre rien plutôt qu’un flux non voulu', () => {
  const streams = [stream({ quality: '360p', language: 'VO' })];
  const out = applyConfig(streams, {
    ...DEFAULT_CONFIG, qualities: ['1080p'], languages: ['VF'], fallback: 'strict',
  });
  assert.equal(out.length, 0);
});

test('l’ordre des langues choisi par l’utilisateur pilote le tri', () => {
  const streams = [
    stream({ language: 'VOSTFR', quality: '720p' }),
    stream({ url: 'https://b/b.m3u8', language: 'VF', quality: '720p' }),
  ];
  const vostfrFirst = applyConfig(streams, { ...DEFAULT_CONFIG, languages: ['VOSTFR', 'VF'] });
  assert.equal(vostfrFirst[0]!.language, 'VOSTFR');

  const vfFirst = applyConfig(streams, { ...DEFAULT_CONFIG, languages: ['VF', 'VOSTFR'] });
  assert.equal(vfFirst[0]!.language, 'VF');
});

test('« qualité puis langue » inverse la priorité', () => {
  const streams = [
    stream({ language: 'VF', quality: '480p' }),
    stream({ url: 'https://b/b.m3u8', language: 'VOSTFR', quality: '4K' }),
  ];
  const byLang = applyConfig(streams, { ...DEFAULT_CONFIG, sort: 'lang', languages: ['VF', 'VOSTFR'] });
  assert.equal(byLang[0]!.quality, '480p', 'langue d’abord : la VF passe devant');

  const byQuality = applyConfig(streams, { ...DEFAULT_CONFIG, sort: 'quality', languages: ['VF', 'VOSTFR'] });
  assert.equal(byQuality[0]!.quality, '4K', 'qualité d’abord : le 4K passe devant');
});

test('la qualité préférée remonte en tête de sa langue', () => {
  const streams = [
    stream({ language: 'VF', quality: '4K' }),
    stream({ url: 'https://b/b.m3u8', language: 'VF', quality: '720p' }),
  ];
  const out = applyConfig(streams, { ...DEFAULT_CONFIG, preferredQuality: '720p' });
  assert.equal(out[0]!.quality, '720p');
});

test('à égalité, un flux direct passe devant un flux proxifié', () => {
  const streams = [
    stream({ url: 'https://a/a.m3u8', headers: PROXIED }),
    stream({ url: 'https://b/b.m3u8' }),
  ];
  const out = applyConfig(streams, DEFAULT_CONFIG);
  assert.equal(out[0]!.url, 'https://b/b.m3u8');
});
