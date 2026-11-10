// Reads a repo's main-line history and decides which commits could change what the app looks like.

export type Commit = { sha: string; date: string; title: string };

const RS = '\x1e', US = '\x1f';
/** The git log format parseLog expects: one record per commit, fields split by unit separators. */
export const LOG_FORMAT = `%H${US}%ad${US}%s${US}%b${RS}`;

/** A merged PR's subject is "Merge pull request #7 from user/branch"; its title is the first line of the body. */
export function parseLog(out: string): Commit[] {
  return out.split(RS).map((r) => r.replace(/^\s+/, '')).filter(Boolean).map((record) => {
    const [sha = '', date = '', subject = '', body = ''] = record.split(US);
    const merge = /^Merge (pull request|branch)\b/.test(subject);
    const firstBodyLine = body.split('\n').map((l) => l.trim()).find(Boolean);
    return { sha, date, title: (merge && firstBodyLine) || subject };
  });
}

// Files that can't change what the app shows: lockfiles, CI, docs, tests, data and scripts.
const INVISIBLE = [
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|package\.json)$/,
  /^\.github\//, /^\.claude\//, /\.mdx?$/i, /^(docs?|tests?|__tests__|scripts|data)\//, /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/,
  /^(LICENSE|\.gitignore|\.editorconfig|\.prettierrc.*|eslint\.config\.[cm]?js)$/,
];

/** True when at least one changed file could change the rendered app. */
export const looksVisible = (files: string[]) => files.some((f) => !INVISIBLE.some((re) => re.test(f)));

/** Next.js basePath from a next.config file's text, so the tool knows where the app is served. */
export function basePathOf(config: string): string {
  const m = /basePath\s*:\s*["'`](\/[^"'`]*)["'`]/.exec(config);
  return m ? m[1]!.replace(/\/+$/, '') : '';
}
