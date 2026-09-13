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

test('les trois écritures du saut sont reconnues', async () => {
  // location.href =, location.replace(…) et location.assign(…) font la même
  // chose ; n'en reconnaître qu'une laissait passer les deux autres.
  for (const [i, saut] of [
    "window.location.href = 'https://cible.invalid/e/a'",
    "location.replace('https://cible.invalid/e/a')",
    "window.location.assign('https://cible.invalid/e/a')",
  ].entries()) {
    const { result } = await withFetch(
      {
        ['facade' + i + '.invalid']: { body: '<title>Redirecting...</title><script>' + saut + ';</script>' },
        'cible.invalid': { body: 'var p={"file":"https://cdn.invalid/z/master.m3u8"};' },
      },
      () => extractEmbed('https://facade' + i + '.invalid/e/a', 'https://site.invalid/'),
    );
    assert.equal(result[0]?.url, 'https://cdn.invalid/z/master.m3u8', 'forme ' + i);
  }
});

test('la coquille hgcloud est reconnue et son saut rejoué sur les miroirs', async () => {
  // hglink.to ne sert que 452 octets ; son main.js obfusqué ne cite aucun
  // domaine, donc la cible se rejoue sur les miroirs connus.
  const { result, seen } = await withFetch(
    {
      'hglink.invalid': {
        body: '<html><head><title>Loading...</title></head><body>'
          + '<div class="loading-text">Page is loading, please wait...</div>'
          + '<script src="/main.js?v=1.1.9"></script></body></html>',
      },
      // Le premier miroir ne connaît pas la vidéo, le second oui.
      'vibuxer.com': { status: 404, body: '' },
      'audinifer.com': { body: 'var p={"file":"https://cdn.invalid/hg/master.m3u8?t=1"};' },
    },
    () => extractEmbed('https://hglink.invalid/e/abc123', 'https://site.invalid/'),
  );

  assert.equal(result[0]?.server, 'HgCloud');
  assert.equal(result[0]?.url, 'https://cdn.invalid/hg/master.m3u8?t=1');
  // L'identifiant doit être repris tel quel sur le miroir.
  assert.ok(seen.some(r => r.url === 'https://audinifer.com/e/abc123'));
});

test('un mur anti-robot est signalé comme tel, pas comme un échec', async () => {
  // mixdrop met un reCAPTCHA v3 devant la résolution de son URL. Le dire
  // explicitement évite de chercher un bug qui n'existe pas — c'est la même
  // leçon que « Video not found or deleted » côté embedseek.
  const { result } = await withFetch(
    {
      'mur.invalid': {
        body: '<html><script src="https://www.google.com/recaptcha/api.js?render=abc"></script>'
          + '<body>lecteur</body></html>',
      },
    },
    () => extractEmbed('https://mur.invalid/e/xyz', 'https://site.invalid/'),
  );
  assert.equal(result.length, 0);
});

test('une façade en 302 est résolue sur son URL d’arrivée', async () => {
  // Régression : kokoflix.lol/chamber_go.php n'est qu'une 302 vers
  // bysesayeveum.com/e/<code>. Le client suit la redirection tout seul, mais
  // si on garde l'URL de départ, Byse cherche son code dans
  // « chamber_go.php » et ne trouve rien — quinze liens perdus par film.
  const real = globalThis.fetch;
  const vues: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    vues.push(url);
    if (url.includes('chamber_go.php')) {
      // Ce que rend fetch après avoir suivi une 302 : le corps du lecteur,
      // mais `res.url` porte l'adresse d'arrivée.
      return Object.defineProperty(
        new Response('<html><script>var p={"file":"https://cdn.invalid/c/master.m3u8"};</script></html>'),
        'url', { value: 'https://lecteur-arrivee.invalid/e/vt0c77ar6763' });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;

  try {
    const r = await extractEmbed(
      'https://facade.invalid/chamber_go.php?id=1S7sbT2Vj0zmpBLWF8yUE',
      'https://movix.invalid/');
    assert.equal(r.length, 1);
    // Le Referer prouve que la suite du traitement a bien vu l'URL d'arrivée.
    assert.equal(r[0]!.headers.Referer, 'https://lecteur-arrivee.invalid/');
  } finally {
    globalThis.fetch = real;
  }
});
