// A minimal Chrome DevTools Protocol client: launch your installed Chrome headless, then send commands.
// No Puppeteer or Playwright download; Node's built-in WebSocket is enough.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

export type Page = {
  send: (method: string, params?: object) => Promise<any>;
  /** Evaluates an expression in the page and returns its JSON value (awaiting promises). */
  eval: <T = unknown>(expression: string) => Promise<T>;
  once: (event: string) => Promise<any>;
  close: () => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function launch(): Promise<Page> {
  const bin = CANDIDATES.find((p) => p && existsSync(p));
  if (!bin) throw new Error('No Chrome or Edge found. Set CHROME_PATH to your browser.');
  const profile = mkdtempSync(join(tmpdir(), 'build-story-chrome-'));
  const chrome: ChildProcess = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', 'about:blank',
  ], { stdio: 'ignore' });

  // Chrome writes the port it picked into the profile once it's ready.
  let port = '';
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]!; } catch { /* not yet */ }
  }
  if (!port) { chrome.kill(); throw new Error('Chrome did not start.'); }
  const pages: any[] = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });

  let id = 0;
  const calls = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  const waiters = new Map<string, ((v: any) => void)[]>();
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.id) {
      const call = calls.get(msg.id);
      calls.delete(msg.id);
      msg.error ? call?.fail(new Error(`${msg.error.message}`)) : call?.ok(msg.result);
    } else if (msg.method) {
      for (const w of waiters.get(msg.method) ?? []) w(msg.params);
      waiters.delete(msg.method);
    }
  };
  const send = (method: string, params: object = {}) => new Promise<any>((ok, fail) => {
    calls.set(++id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const page: Page = {
    send,
    once: (event) => new Promise((ok) => waiters.set(event, [...(waiters.get(event) ?? []), ok])),
    eval: async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'Page script failed');
      return r.result.value;
    },
    close: () => {
      ws.close();
      chrome.kill();
      // Chrome can hold the profile for a moment after exiting.
      setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ } }, 500);
    },
  };
  await send('Page.enable');
  return page;
}

/**
 * The share of pixels that visibly differ between two PNGs, 0 to 1. Both are shrunk to a tenth first,
 * so anti-aliasing and animation noise don't count as a change. Decoded in Chrome: no image library needed.
 */
export async function difference(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.eval<number>(`(async (a, b) => {
    const load = (s) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = 'data:image/png;base64,' + s; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    const w = Math.max(1, Math.round(x.width / 10)), h = Math.max(1, Math.round(x.height / 10));
    const g = new OffscreenCanvas(w, h).getContext('2d');
    g.drawImage(x, 0, 0, w, h); const A = g.getImageData(0, 0, w, h).data;
    g.clearRect(0, 0, w, h);
    g.drawImage(y, 0, 0, w, h); const B = g.getImageData(0, 0, w, h).data;
    let changed = 0;
    for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 48) changed++;
    return changed / (w * h);
  })(${JSON.stringify(a.toString('base64'))}, ${JSON.stringify(b.toString('base64'))})`);
}

/** Loads a URL, waits for load plus a settle delay for fonts and entrance animations, and returns a PNG. */
export async function screenshot(page: Page, url: string, settleMs: number): Promise<Buffer> {
  const loaded = page.once('Page.loadEventFired');
  await page.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(20_000)]);
  await sleep(settleMs);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(data, 'base64');
}
