import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStatus } from './purstream';

// Forme réelle de https://purstream.wiki/api/server-status (2026-11-15).
const panne = {
  checkedAt: '2026-11-15T13:01:45.245Z',
  domainResolvable: true,
  servers: [
    { id: 'main', label: 'Plateforme', url: 'https://purstream.gg/', reachable: false, latencyMs: 15001, statusCode: null },
    { id: 'sources', label: 'Sources', url: 'https://zebi.senpai-stream.store/', reachable: true, latencyMs: 560 },
  ],
};

test('le statut publié donne le domaine ET dit si la plateforme est tombée', () => {
  assert.deepEqual(readStatus(panne), { domain: 'purstream.gg', reachable: false });
});

test('plateforme joignable : on la tente', () => {
  const ok = { servers: [{ id: 'main', url: 'https://purstream.gg/', reachable: true }] };
  assert.deepEqual(readStatus(ok), { domain: 'purstream.gg', reachable: true });
});

test('état absent : inconnu, pas « en panne » — on tente quand même', () => {
  const sansEtat = { servers: [{ id: 'main', url: 'https://purstream.ac' }] };
  assert.deepEqual(readStatus(sansEtat), { domain: 'purstream.ac', reachable: null });
});

test('réponse illisible : rien, pour laisser la main au repli HTML', () => {
  assert.equal(readStatus(null), null);
  assert.equal(readStatus({ servers: [{ id: 'sources', url: 'https://x.test/' }] }), null);
  assert.equal(readStatus('<html>'), null);
});
