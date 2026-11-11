import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMintUrl } from './mint-url.ts';

test('same mint written different ways normalizes to one string', () => {
  const want = 'https://nofees.testnut.cashu.space';
  for (const url of [
    'https://nofees.testnut.cashu.space',
    'https://nofees.testnut.cashu.space/',
    'https://NoFees.TestNut.Cashu.Space',
    'https://nofees.testnut.cashu.space:443',
    ' https://nofees.testnut.cashu.space ',
  ]) {
    assert.equal(normalizeMintUrl(url), want, url);
  }
  assert.equal(normalizeMintUrl('https://mint.example.com/cashu/'), 'https://mint.example.com/cashu');
});

test('refuses http, credentials, query, fragment and junk', () => {
  for (const url of [
    'http://nofees.testnut.cashu.space',
    'https://user:pass@nofees.testnut.cashu.space',
    'https://nofees.testnut.cashu.space?x=1',
    'https://nofees.testnut.cashu.space?',
    'https://nofees.testnut.cashu.space#a',
    'nofees.testnut.cashu.space',
    'javascript:alert(1)',
    '',
    'https://' + 'a'.repeat(600) + '.com',
  ]) {
    assert.equal(normalizeMintUrl(url), null, url);
  }
  assert.equal(normalizeMintUrl(undefined), null);
  assert.equal(normalizeMintUrl(42), null);
});

test('a different port or path is a different mint', () => {
  assert.notEqual(normalizeMintUrl('https://m.example.com:8443'), normalizeMintUrl('https://m.example.com'));
  assert.notEqual(normalizeMintUrl('https://m.example.com/a'), normalizeMintUrl('https://m.example.com/b'));
});
