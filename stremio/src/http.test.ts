import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from './http';

/** Remplace fetch le temps d'un test et compte les tentatives. */
async function withFetch<T>(
  impl: (url: string, init: any) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test("une requête qui expire n'est pas rejouée", async () => {
  // Régression : l'hôte est joignable mais ne répond pas. Réessayer repayait
  // les 12 s du budget, et 12 + 12 suffisaient à faire sauter les 25 s d'un
  // scraper — qui perdait alors les huit flux qu'il avait déjà résolus.
  let attempts = 0;
  const res = await withFetch(
    (_url, init) => {
      attempts++;
      return new Promise<Response>((_, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
        });
      });
    },
    () => request('https://lent.invalid/', { timeoutMs: 30, retries: 1 }),
  );

  assert.equal(attempts, 1);
  assert.equal(res.status, 0);
});

test('une coupure réseau est rejouée', async () => {
  let attempts = 0;
  const res = await withFetch(
    async () => {
      attempts++;
      throw new Error('fetch failed');
    },
    () => request('https://coupe.invalid/', { timeoutMs: 5000, retries: 1 }),
  );

  assert.equal(attempts, 2);
  assert.equal(res.status, 0);
});

test('une coupure suivie d\'un succès rend la réponse', async () => {
  let attempts = 0;
  const res = await withFetch(
    async () => {
      attempts++;
      if (attempts === 1) throw new Error('ECONNRESET');
      return new Response('ok', { status: 200 });
    },
    () => request('https://intermittent.invalid/', { timeoutMs: 5000, retries: 1 }),
  );

  assert.equal(attempts, 2);
  assert.equal(res.status, 200);
  assert.equal(res.text, 'ok');
});
