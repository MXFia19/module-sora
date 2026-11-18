import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { embedseekId, parseResolve } from './embed4me';

test('embedseek : identifiant lu dans le fragment ou dans ?id=', () => {
  assert.equal(embedseekId('https://neocine.embedseek.com/#8weaf'), '8weaf');
  assert.equal(embedseekId('https://coflix.upn.one/#mstovi'), 'mstovi');
  assert.equal(embedseekId('https://x.seekplayer.vip/?id=abc12'), 'abc12');
  assert.equal(embedseekId('https://neocine.embedseek.com/'), null);
});

test('embedseek : /api/public/resolve mène au lecteur suivant', () => {
  const hop = parseResolve('{"ok":true,"url":"https://turboembed.com/g25u","host1":"seek","file1":"8weaf","host2":"turbovio","file2":"g25u","link2":"https://turboembed.com/g25u"}');
  assert.deepEqual(hop, { next: 'https://turboembed.com/g25u', nextHost: 'turbovio' });
});

test('embedseek : un fichier retiré est dit retiré, pas « non reconnu »', () => {
  assert.deepEqual(parseResolve('{"ok":false,"error":"not found"}'), { gone: 'not found' });
});

test('embedseek : une réponse qui n\'est pas celle de l\'API ne donne rien', () => {
  assert.equal(parseResolve('<!DOCTYPE html><title>Error</title>'), null);
  assert.equal(parseResolve('{"ok":true,"url":"/relative"}'), null);
});
