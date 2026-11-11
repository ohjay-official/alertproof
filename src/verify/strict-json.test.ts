import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJson, StrictJsonError, MAX_SECRET_LENGTH } from './strict-json.ts';

const ok = (text: string) => parseStrictJson(text);
const bad = (text: string) => assert.throws(() => parseStrictJson(text), StrictJsonError, text);

test('reads the NUT-11 example secret, compact and with spaces', () => {
  const compact =
    '["P2PK",{"nonce":"859d4935c4907062a6297cf4e663e2835d90d97ecdd510745d32f6816323a41f","data":"0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7","tags":[["sigflag","SIG_INPUTS"]]}]';
  const spaced = compact.replaceAll(',', ', ').replaceAll(':', ': ');
  for (const text of [compact, spaced, `\n  ${spaced}\r\n`]) {
    const v = ok(text) as unknown[];
    assert.equal(v[0], 'P2PK');
    const body = v[1] as Map<string, unknown>;
    assert.equal(body.get('data'), '0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7');
    assert.deepEqual(body.get('tags'), [['sigflag', 'SIG_INPUTS']]);
  }
});

test('reads empty arrays and objects', () => {
  assert.deepEqual(ok('[]'), []);
  assert.ok(ok('{}') instanceof Map);
  assert.deepEqual(ok('[[],[""]]'), [[], ['']]);
});

test('refuses duplicate keys (parsers disagree on which one wins)', () => {
  bad('{"data":"a","data":"b"}');
  bad('["P2PK",{"nonce":"n","data":"x","tags":[],"data":"y"}]');
});

test('refuses backslashes, so no escapes of any kind', () => {
  bad('["\\u0050\\u0032PK"]');
  bad('["a\\"b"]');
  bad('["a\\\\b"]');
  bad('["\\ud800"]');
});

test('refuses anything outside printable ASCII', () => {
  bad('["P2PK "]');
  bad('﻿["P2PK"]');
  bad('["café"]');
  bad('["a\u0000"]');
  bad('["a "]');
});

test('refuses raw tab or newline inside a string', () => {
  bad('["a\tb"]');
  bad('["a\nb"]');
});

test('refuses numbers, booleans and null', () => {
  bad('[1]');
  bad('["locktime", 1765300829]');
  bad('[true]');
  bad('[null]');
  bad('{"tags":null}');
});

test('refuses trailing commas, missing commas, junk after the value', () => {
  bad('["a",]');
  bad('{"a":"b",}');
  bad('["a" "b"]');
  bad('["a"]x');
  bad('["a"]]');
  bad('["a"');
  bad('{"a" "b"}');
  bad('{a:"b"}');
  bad("['a']");
  bad('');
  bad('   ');
});

test('refuses deep nesting without blowing the stack', () => {
  // five levels is the most a real secret uses: [ { [ [ "string" ] ] } ]
  ok('['.repeat(5) + ']'.repeat(5));
  bad('['.repeat(6) + ']'.repeat(6));
  bad('['.repeat(500) + ']'.repeat(500));
  bad('['.repeat(10000));
});

test('accepts depth used by a real secret, refuses one level more', () => {
  ok('[{"tags":[["sigflag","SIG_INPUTS"]]}]');
  bad('[{"tags":[[["x"]]]}]');
});

test('refuses input over the length cap', () => {
  ok('["' + 'a'.repeat(MAX_SECRET_LENGTH - 4) + '"]');
  bad('["' + 'a'.repeat(MAX_SECRET_LENGTH - 3) + '"]');
});

test('object keys like __proto__ stay plain data', () => {
  const v = ok('{"__proto__":"x","constructor":"y"}') as Map<string, unknown>;
  assert.equal(v.get('__proto__'), 'x');
  assert.equal(Object.getPrototypeOf(v), Map.prototype);
});
