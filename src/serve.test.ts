import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFile } from './serve.ts';

test('resolveFile maps static-export URLs under a base path and never leaves the root', () => {
  const root = mkdtempSync(join(tmpdir(), 'bs-out-'));
  mkdirSync(join(root, 'near-me'));
  writeFileSync(join(root, 'index.html'), 'home');
  writeFileSync(join(root, 'about.html'), 'about');
  writeFileSync(join(root, 'near-me', 'index.html'), 'near');
  writeFileSync(join(root, 'app.js'), 'js');

  assert.equal(resolveFile(root, '/lapar-wheel', '/lapar-wheel'), join(root, 'index.html'));
  assert.equal(resolveFile(root, '/lapar-wheel', '/lapar-wheel/'), join(root, 'index.html'));
  assert.equal(resolveFile(root, '/lapar-wheel', '/lapar-wheel/about'), join(root, 'about.html'));
  assert.equal(resolveFile(root, '/lapar-wheel', '/lapar-wheel/near-me/'), join(root, 'near-me', 'index.html'));
  assert.equal(resolveFile(root, '', '/app.js'), join(root, 'app.js'));
  assert.equal(resolveFile(root, '', '/../../etc/passwd'), null);
  assert.equal(resolveFile(root, '', '/..%2f..%2fsecret'), null);
  assert.equal(resolveFile(root, '', '/%E0%A4%A'), null, 'a malformed URL is a miss, not a crash');
  assert.equal(resolveFile(root, '', '/missing'), null);
});
