import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEmbed } from './index';

/** Remplace fetch le temps d'un test. Les réponses sont données par hôte+chemin. */
async function withFetch<T>(
  routes: Record<string, { status?: number; body: string }>,
  fn: () => Promise<T>,
): Promise<{ result: T; seen: Array<{ url: string; body?: string }> }> {
  const real = globalThis.fetch;
  const seen: Array<{ url: string; body?: string }> = [];

  globalThis.fetch = (async (input: any, init: any) => {
    const url = typeof input === 'string' ? input : input.url;
    seen.push({ url, body: init?.body });
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return new Response('', { status: 404 });
    return new Response(hit[1].body, { status: hit[1].status ?? 200 });
  }) as typeof fetch;

  try {
    return { result: await fn(), seen };
  } finally {
    globalThis.fetch = real;
  }
}

test('une coquille de redirection est suivie jusqu\'au vrai lecteur', async () => {
  // Régression : VOE renouvelle ses domaines de façade (rebeccapracticeloss.com,
  // kokoflix.lol/osaka_go.php…). Les reconnaître par leur nom est une course
  // perdue ; la page de saut, elle, est toujours la même.
  const { result, seen } = await withFetch(
    {
      'faconde-du-jour.invalid': {
        body: `<html><head><title>Redirecting...</title></head><body><script>
          window.location.href = 'https://vrai-lecteur.invalid/e/zz1';
        </script></body></html>`,
      },
      'vrai-lecteur.invalid': {
        body: '<html><script>var p = {"file":"https://cdn.invalid/a/master.m3u8"};</script></html>',
      },
    },
    () => extractEmbed('https://faconde-du-jour.invalid/e/zz1', 'https://site.invalid/'),
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]!.url, 'https://cdn.invalid/a/master.m3u8');
  // Le Referer doit désigner le lecteur d'arrivée, pas la façade traversée.
  assert.equal(result[0]!.headers.Referer, 'https://vrai-lecteur.invalid/');
  assert.ok(seen.some(r => r.url.includes('vrai-lecteur.invalid')));
});

test('une page trop longue ne passe pas pour une coquille', async () => {
  // Un vrai lecteur contient souvent un location.href dans son code ; seule
  // une page minuscule est une redirection.
  const { result } = await withFetch(
    {
      'gros-lecteur.invalid': {
        body: '<html><script>if(x)window.location.href = "https://ailleurs.invalid/";</script>'
          + 'var p={"file":"https://cdn.invalid/b/master.m3u8"};' + 'x'.repeat(5000) + '</html>',
      },
    },
    () => extractEmbed('https://gros-lecteur.invalid/e/zz2', 'https://site.invalid/'),
  );

  assert.equal(result[0]?.url, 'https://cdn.invalid/b/master.m3u8');
});

test('Vidara lit son URL sur /api/stream', async () => {
  const { result, seen } = await withFetch(
    {
      '/api/stream': {
        body: JSON.stringify({
          filecode: 'AbC123',
          streaming_url: 'https://s25.invalid/hls/xyz/master.m3u8?token=t',
          title: 'Un.Film.1080p',
        }),
      },
    },
    () => extractEmbed('https://vidara.to/e/AbC123', 'https://wiflix.invalid/'),
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]!.server, 'Vidara');
  assert.equal(result[0]!.url, 'https://s25.invalid/hls/xyz/master.m3u8?token=t');

  const call = seen.find(r => r.url.includes('/api/stream'));
  assert.ok(call, 'l\'API doit être appelée');
  assert.match(String(call.body), /"filecode":"AbC123"/);
});
