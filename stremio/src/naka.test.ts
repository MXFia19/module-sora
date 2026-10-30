import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { findToken, describeShape, nakaQuality, nakaLanguage, toRawStream, nakaCacheKey, isBotWall, NAKA_ORIGIN } from './naka';
import { encodeConfig, decodeConfig, DEFAULT_CONFIG } from './userconfig';
import { configurePage } from './configure';
import type { UserConfig } from './userconfig';

const TOKEN = 'oat_MTIzNDU2Nzg5MA.abcdefghijklmnopqrstuvwxyz0123456789';
const auth = { token: TOKEN };

test('le jeton est trouvé à plat, imbriqué façon AdonisJS, ou sous data', () => {
  assert.equal(findToken({ token: TOKEN }), TOKEN);
  assert.equal(findToken({ token: { type: 'bearer', token: TOKEN } }), TOKEN);
  assert.equal(findToken({ data: { accessToken: TOKEN } }), TOKEN);
  assert.equal(findToken({ user: { id: 1 }, session: { access_token: TOKEN } }), TOKEN);
});

test('pas de jeton inventé : chaîne courte ou absente -> null', () => {
  assert.equal(findToken({ token: 'court' }), null);
  assert.equal(findToken({ message: 'ok' }), null);
  assert.equal(findToken(null), null);
  assert.equal(findToken('x'.repeat(40)), null);
});

test('le diagnostic décrit la forme sans laisser passer une seule valeur', () => {
  const shape = describeShape({ token: TOKEN, user: { username: 'secret-pseudo', id: 7 }, profiles: [{ pin: '1234' }] });
  const text = JSON.stringify(shape);
  assert.ok(!text.includes(TOKEN));
  assert.ok(!text.includes('secret-pseudo'));
  assert.ok(!text.includes('1234'));
  assert.deepEqual(shape, {
    token: `string(${TOKEN.length})`,
    user: { username: 'string(13)', id: 'number' },
    profiles: [{ pin: 'string(4)' }],
  });
});

test('les qualités Naka tombent sur l’échelle de l’addon', () => {
  assert.equal(nakaQuality('1080p'), '1080p');
  assert.equal(nakaQuality(2160), '4K');
  assert.equal(nakaQuality('4K'), '4K');
  assert.equal(nakaQuality('720p'), '720p');
  assert.equal(nakaQuality('480'), '480p');
  assert.equal(nakaQuality(undefined), 'HD');
});

test('la langue se déduit des champs disponibles, VF par défaut', () => {
  assert.equal(nakaLanguage({}), 'VF');
  assert.equal(nakaLanguage({ language: 'VOSTFR' }), 'VOSTFR');
  assert.equal(nakaLanguage({ audioTracks: [{ lang: 'fr' }, { lang: 'ja' }] }), 'MULTI');
  assert.equal(nakaLanguage({ version: 'multi' }), 'MULTI');
});

test('directUrl passe en premier, sans jeton joint', () => {
  const s = toRawStream({
    type: 'encoded', maxQuality: '1080p',
    url: '/api/v1/r2/abc/master.m3u8?sig=1',
    directUrl: 'https://cdn.example.net/abc/master.m3u8',
    subtitles: [{ url: '/api/v1/r2/abc/subs/fr.vtt?sig=1', lang: 'fr' }],
  }, auth)!;
  assert.equal(s.url, 'https://cdn.example.net/abc/master.m3u8');
  assert.equal(s.quality, '1080p');
  assert.equal(s.headers?.Authorization, undefined);
  // Le sous-titre suit le dossier du directUrl, comme le lecteur du site.
  assert.equal(s.subtitles?.[0]?.url, 'https://cdn.example.net/abc/subs/fr.vtt');
  assert.equal(s.subtitles?.[0]?.headers, undefined);
  assert.equal(s.subtitles?.[0]?.lang, 'fre');
});

test('sans directUrl, le lien naka.cx emporte la session (donc le proxy)', () => {
  const s = toRawStream({ url: '/api/v1/r2/abc/master.m3u8' }, { token: TOKEN, profile: 3 })!;
  assert.equal(s.url, `${NAKA_ORIGIN}/api/v1/r2/abc/master.m3u8`);
  assert.equal(s.headers?.Authorization, `Bearer ${TOKEN}`);
  assert.equal(s.headers?.['X-Profile-Id'], '3');
  assert.equal(s.headers?.Accept, undefined);
  assert.equal(s.container, 'hls');
});

test('une source sans lien est ignorée', () => {
  assert.equal(toRawStream({ type: 'encoded' }, auth), null);
});

test('la clé de cache Naka ne contient jamais le jeton et distingue les profils', () => {
  const a = nakaCacheKey({ token: TOKEN });
  const b = nakaCacheKey({ token: TOKEN, profile: 2 });
  assert.ok(!a.includes(TOKEN.slice(0, 12)));
  assert.notEqual(a, b);
  assert.notEqual(a, nakaCacheKey({ token: TOKEN + 'x' }));
});

test('la session Naka fait l’aller-retour dans le lien d’installation', () => {
  const c: UserConfig = { ...DEFAULT_CONFIG, naka: { token: TOKEN, profile: 4 } };
  assert.deepEqual(decodeConfig(encodeConfig(c)).naka, c.naka);
  const noProfile: UserConfig = { ...DEFAULT_CONFIG, naka: { token: TOKEN } };
  // Pas de profil = pas de clé « profile » du tout, pas « profile: undefined ».
  assert.deepEqual(decodeConfig(encodeConfig(noProfile)).naka, { token: TOKEN });
  // Sans Naka, le lien ne gagne aucune clé.
  assert.equal('naka' in decodeConfig(encodeConfig(DEFAULT_CONFIG)), false);
});

test('un jeton Naka trop court dans le lien est ignoré', () => {
  const encoded = Buffer.from(JSON.stringify({ m: 'direct', nk: 'abc' })).toString('base64url');
  assert.equal(decodeConfig(encoded).naka, undefined);
});

/** Le script de la page n'est qu'une chaîne pour TypeScript : une apostrophe
 *  mal échappée le casse sans que la compilation le voie. */
function pageScript(html: string): string {
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, 'balise <script> absente');
  return m[1]!;
}

test('le script de la page de configuration est du JavaScript valide (avec et sans Naka)', () => {
  const linked = encodeConfig({ ...DEFAULT_CONFIG, naka: { token: TOKEN, profile: 2 } });
  for (const encoded of [undefined, linked]) {
    for (const base of ['https://addon.example', null]) {
      const script = pageScript(configurePage(base, [], encoded));
      assert.doesNotThrow(() => new vm.Script(script), `script invalide (base=${base}, naka=${Boolean(encoded)})`);
    }
  }
});

test('la session pré-remplie ne peut pas fermer la balise <script>', () => {
  const hostile = encodeConfig({ ...DEFAULT_CONFIG, naka: { token: '</script><script>alert(1)</script>xxxx' } });
  const html = configurePage('https://addon.example', [], hostile);
  assert.equal(html.split('</script>').length, 2, 'une seule fermeture de <script>');
  assert.doesNotThrow(() => new vm.Script(pageScript(html)));
});

test('le défi Cloudflare est reconnu comme tel, pas comme un refus de Naka', () => {
  const page = '<!DOCTYPE html><html><head><title>Just a moment...</title>';
  assert.equal(isBotWall({ status: 403, headers: new Headers(), text: page }), true);
  assert.equal(isBotWall({ status: 403, headers: new Headers({ 'cf-mitigated': 'challenge' }), text: '' }), true);
  // Un vrai refus de l'API (JSON) n'est pas un mur anti-robots.
  assert.equal(isBotWall({ status: 403, headers: new Headers(), text: '{"code":"PROFILE_LOCKED"}' }), false);
  assert.equal(isBotWall({ status: 404, headers: new Headers(), text: page }), false);
});
