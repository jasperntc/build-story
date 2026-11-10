import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basePathOf, LOG_FORMAT, looksVisible, parseLog } from './git.ts';

test('parseLog uses PR titles for merge commits and subjects otherwise', () => {
  const [RS, US] = ['\x1e', '\x1f'];
  assert.equal(LOG_FORMAT.includes(US) && LOG_FORMAT.endsWith(RS), true);
  const out = [
    ['a1', '2026-10-13', 'Initial commit', ''],
    ['b2', '2026-10-20', 'Merge pull request #1 from me/feat/scaffold', '\nScaffold Lapar Wheel\n\nMore detail'],
    ['c3', '2026-10-21', 'Merge branch main', ''],
  ].map((f) => f.join(US) + RS + '\n').join('');
  assert.deepEqual(parseLog(out), [
    { sha: 'a1', date: '2026-10-13', title: 'Initial commit' },
    { sha: 'b2', date: '2026-10-20', title: 'Scaffold Lapar Wheel' },
    { sha: 'c3', date: '2026-10-21', title: 'Merge branch main' },
  ]);
});

test('looksVisible skips dependency bumps, CI, docs and tests, but keeps app code and assets', () => {
  assert.equal(looksVisible(['package.json', 'package-lock.json']), false, 'a Dependabot bump');
  assert.equal(looksVisible(['.github/workflows/ci.yml', 'README.md', 'docs/spec.md']), false);
  assert.equal(looksVisible(['lib/filter.test.ts', 'tests/e2e.spec.ts', 'scripts/pull.ts']), false);
  assert.equal(looksVisible(['package.json', 'app/page.tsx']), true);
  assert.equal(looksVisible(['public/logo.svg']), true);
  assert.equal(looksVisible(['lib/filter.ts']), true);
});

test('basePathOf reads a Next.js basePath', () => {
  assert.equal(basePathOf('const c = { output: "export", basePath: "/lapar-wheel", images: {} }'), '/lapar-wheel');
  assert.equal(basePathOf("basePath: '/app/'"), '/app');
  assert.equal(basePathOf('const c = {}'), '');
});
