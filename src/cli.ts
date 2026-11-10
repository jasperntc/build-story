#!/usr/bin/env node
// build-story: builds a web app at every visible commit on its main line, screenshots each build,
// and records a captioned 9:16 video of the app growing. Works in a temporary clone; your repo is untouched.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { difference, launch, screenshot } from './chrome.ts';
import { basePathOf, LOG_FORMAT, looksVisible, parseLog, type Commit } from './git.ts';
import { serve } from './serve.ts';

const fail = (msg: string): never => { console.error(msg); process.exit(1); };
const { values: args, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        build: { type: 'string', default: 'npm run build' },
        dist: { type: 'string', default: 'out' },
        base: { type: 'string' },
        size: { type: 'string', default: '390x844' },
        hold: { type: 'string', default: '1.1' },
        settle: { type: 'string', default: '2500' },
        title: { type: 'string' },
        max: { type: 'string' },
        all: { type: 'boolean' },
        keep: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    return fail(`${(err as Error).message}\nRun with --help to see the options.`);
  }
})();

if (args.help) {
  console.log(`build-story <repo>: a captioned 9:16 video of a web app growing, one frame per build

  -o, --out <dir>     where frames and the video go (default ./build-story-<repo>)
  --build <cmd>       build command, run in each checkout (default "npm run build")
  --dist <dir>        static output folder the build writes (default "out")
  --base <path>       URL base path (default: read from next.config basePath)
  --size <WxH>        phone viewport in CSS pixels (default 390x844)
  --hold <seconds>    time each build stays on screen (default 1.1)
  --settle <ms>       wait after page load before the screenshot (default 2500)
  --title <text>      title in the video (default: the repo folder name)
  --max <n>           at most n frames, picked evenly, always keeping the last
  --all               include commits that only touch lockfiles, CI, docs or tests
  --keep              keep the temporary clone for debugging

Walks the repo's main line (first-parent), builds each commit in a temporary clone,
and records the video with your installed Chrome. Your repo is never modified.`);
  process.exit(0);
}

const repo = resolve(positionals[0] ?? '.');
if (!existsSync(join(repo, '.git'))) fail(`${repo} is not a git repository.`);
const [width, height] = (/^(\d{3,4})x(\d{3,4})$/.exec(args.size!) ?? fail('--size looks like 390x844')).slice(1).map(Number) as [number, number];
const hold = Number(args.hold), settle = Number(args.settle);
if (!(hold >= 0.3 && hold <= 10)) fail('--hold must be between 0.3 and 10 seconds.');
if (!(settle >= 0 && settle <= 60_000)) fail('--settle must be between 0 and 60000 ms.');
const name = basename(repo);
const out = resolve(args.out ?? `build-story-${name}`);
mkdirSync(join(out, 'frames'), { recursive: true });

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

// 1. Pick the commits worth a frame.
const all = parseLog(git(repo, 'log', '--first-parent', '--reverse', `--format=${LOG_FORMAT}`, '--date=short'));
let picked: Commit[] = all.filter((c, i) => {
  if (args.all) return true;
  const files = i === 0 ? git(repo, 'ls-tree', '-r', '--name-only', c.sha) : git(repo, 'diff', '--name-only', all[i - 1]!.sha, c.sha);
  return looksVisible(files.split('\n').filter(Boolean));
});
if (args.max) {
  const n = Math.max(2, Number(args.max));
  if (picked.length > n) picked = Array.from({ length: n }, (_, k) => picked[Math.round((k * (picked.length - 1)) / (n - 1))]!);
}
console.log(`${all.length} commits on the main line; ${picked.length} could change what the app shows.`);
if (!picked.length) fail('Nothing to build.');

// 2. Build and screenshot each one in a throwaway clone.
const tmp = mkdtempSync(join(tmpdir(), 'build-story-'));
const work = join(tmp, 'app');
git(tmp, 'clone', '--quiet', '--no-checkout', repo, work);
const run = (cmd: string) => spawnSync(cmd, { cwd: work, shell: true, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 });

type Frame = { src: string; sha: string; date: string; title: string };
const frames: Frame[] = [];
const extras: Record<string, string> = {};
let base = '';
const { server, url } = await serve(() => join(work, args.dist!), () => base, () => extras);
const page = await launch();
const errorsLog = join(out, 'build-errors.log');
writeFileSync(errorsLog, '');
let lastDeps = '';
let lastShot: Buffer | null = null;

try {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  for (const [k, c] of picked.entries()) {
    const started = Date.now();
    const label = `[${String(k + 1).padStart(2)}/${picked.length}] ${c.sha.slice(0, 7)} ${c.title.slice(0, 60)}`;
    git(work, 'checkout', '--quiet', '--force', c.sha);
    git(work, 'clean', '-fdxq', '-e', 'node_modules');
    if (!existsSync(join(work, 'package.json'))) { console.log(`${label}  · skipped, no package.json yet`); continue; }

    const lock = ['package-lock.json', 'npm-shrinkwrap.json', 'package.json'].map((f) => join(work, f)).find(existsSync)!;
    const deps = sha256(readFileSync(lock));
    if (deps !== lastDeps) {
      const install = run(lock.endsWith('package.json') ? 'npm install --no-audit --no-fund' : 'npm ci --no-audit --no-fund');
      if (install.status !== 0) {
        writeFileSync(errorsLog, `${label}\n${install.stderr}\n\n`, { flag: 'a' });
        console.log(`${label}  ✗ install failed (see build-errors.log)`);
        continue;
      }
      lastDeps = deps;
    }
    // One retry: some builds stop once with a notice (Next.js does for a version with a known advisory) and pass on a rerun.
    let build = run(args.build!);
    if (build.status !== 0) build = run(args.build!);
    if (build.status !== 0 || !existsSync(join(work, args.dist!))) {
      writeFileSync(errorsLog, `${label}\n${build.stdout?.slice(-4000)}\n${build.stderr?.slice(-4000)}\n\n`, { flag: 'a' });
      console.log(`${label}  ✗ build failed (see build-errors.log)`);
      continue;
    }

    const config = ['next.config.ts', 'next.config.mjs', 'next.config.js'].map((f) => join(work, f)).find(existsSync);
    base = args.base ?? (config ? basePathOf(readFileSync(config, 'utf8')) : '');
    // The server strips this commit's base path, so one server works for every commit.
    const pageUrl = `${url}${base}/`.replace(/([^:])\/\/+/g, '$1/');
    const status = (await fetch(pageUrl)).status;
    if (status !== 200) { console.log(`${label}  ✗ the build has no page at ${base || '/'} (HTTP ${status})`); continue; }
    const png = await screenshot(page, pageUrl, settle);
    // Under 1% of (shrunk) pixels changed reads as the same screen in a video.
    const changed = lastShot ? await difference(page, lastShot, png) : 1;
    if (changed < 0.01) { console.log(`${label}  · looks the same as the last frame, skipped`); continue; }
    lastShot = png;
    const file = `${String(frames.length + 1).padStart(3, '0')}.png`;
    writeFileSync(join(out, 'frames', file), png);
    frames.push({ src: `frames/${file}`, sha: c.sha, date: c.date, title: c.title });
    console.log(`${label}  ✓ ${Math.round((Date.now() - started) / 1000)}s`);
  }
  if (!frames.length) fail('No commit built. See build-errors.log.');

  // 3. Compose the video in the same Chrome.
  const days = Math.max(1, Math.round((Date.parse(frames.at(-1)!.date) - Date.parse(frames[0]!.date)) / 864e5));
  const story = { title: args.title ?? name, hold, frames, outro: `${frames.length} builds · ${days} days · built in public` };
  writeFileSync(join(out, 'frames.json'), JSON.stringify(story, null, 2));
  const composer = [join(import.meta.dirname, '..', 'assets', 'compose.html'), join(import.meta.dirname, '..', '..', 'assets', 'compose.html')].find(existsSync)!;
  Object.assign(extras, {
    '/__story/compose.html': composer,
    '/__story/frames.json': join(out, 'frames.json'),
    ...Object.fromEntries(frames.map((f) => [`/__story/${f.src}`, join(out, f.src)])),
  });
  await page.send('Emulation.clearDeviceMetricsOverride');
  await screenshot(page, `${url}/__story/compose.html`, 300);
  for (let i = 0; i < 100 && !(await page.eval<boolean>('window.ready === true')); i++) await new Promise((r) => setTimeout(r, 100));
  writeFileSync(join(out, 'cover.png'), Buffer.from(await page.eval<string>('window.poster()'), 'base64'));
  console.log(`Recording ${frames.length} frames…`);
  const video = await page.eval<{ mime: string; data: string; seconds: number }>('window.render()');
  const videoFile = join(out, `story.${video.mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
  writeFileSync(videoFile, Buffer.from(video.data, 'base64'));
  console.log(`\nDone: ${videoFile} (${Math.round(video.seconds)}s, ${frames.length} frames)\nCover: ${join(out, 'cover.png')}`);
  if (videoFile.endsWith('.webm')) console.log('This Chrome could not record MP4. Instagram needs MP4: convert the WebM, or run with Google Chrome.');
} finally {
  page.close();
  server.close();
  if (args.keep) console.log(`Kept the clone at ${work}`);
  else rmSync(tmp, { recursive: true, force: true });
}
