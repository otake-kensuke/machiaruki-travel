import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Read-only local audit. Print locations/categories, never matched credential values.
const root = fileURLToPath(new URL('../', import.meta.url));
function git(args, binary = false) {
  const result = spawnSync('git', args, { cwd: root, encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Git audit read failed');
  return result.stdout;
}
const rules = [
  ['service-token', /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,})/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['credential-value', /\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*['"][^'"\r\n]{4,}['"]/i],
  ['personal-email', /[A-Z0-9._%+-]+@(?!users\.noreply\.github\.com)[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ['personal-path', /(?:C:[/\\]Users[/\\]|\/Users\/|\/home\/)[A-Za-z0-9_-]+/],
  ['phone-number', /(?:\+81[- ]?|0)(?:70|80|90)[- ]\d{4}[- ]\d{4}/],
  ['reservation-value', /(?:予約番号|予約確認番号|confirmation[_ ]?(?:number|code)|booking[_ ]?(?:id|reference))\s*[：:=]\s*['"]?[A-Za-z0-9-]{5,}/i]
];
const findings = [];
function scan(buffer, location) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset); const type = buffer.toString('ascii', offset + 4, offset + 8);
      if (['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(type)) findings.push({ location, category: 'image-metadata' });
      offset += length + 12;
    }
    return;
  }
  const text = buffer.toString('utf8');
  for (const [category, pattern] of rules) if (pattern.test(text)) findings.push({ location, category });
}
const paths = new Map(git(['rev-list', '--objects', '--all', '--reflog']).trim().split('\n').map(line => { const split = line.indexOf(' '); return split < 0 ? [line, ''] : [line.slice(0, split), line.slice(split + 1)]; }));
const objects = git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)']).trim().split('\n').map(line => line.split(' '));
let blobs = 0; let commits = 0;
for (const [sha, type] of objects) {
  if (type === 'blob') { blobs++; scan(git(['cat-file', 'blob', sha], true), `git:${sha.slice(0, 12)}:${paths.get(sha) || '(unreferenced)'}`); }
  if (type === 'commit') {
    commits++; const commit = git(['cat-file', 'commit', sha]);
    for (const line of commit.split('\n').filter(value => /^(author|committer) /.test(value))) {
      if (!/<[^<>]+@users\.noreply\.github\.com>/.test(line)) findings.push({ location: `commit:${sha.slice(0, 12)}`, category: 'review-author-identity' });
    }
    scan(Buffer.from(commit.split('\n\n').slice(1).join('\n\n')), `commit-message:${sha.slice(0, 12)}`);
  }
}
const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
const forbidden = /(?:^|\/)(?:\.env(?:\.|$)|credentials\.json$|secrets\.json$|backups?\/|exports\/|local-data\/|test-results\/)|(?:\.backup\.json|\.personal\.json|\.private\.json|\.pem|\.p12|\.pfx)$|machiaruki-travel-(?:backup|before-restore).*\.json$/i;
for (const file of files) {
  if (forbidden.test(file)) findings.push({ location: file, category: 'private-file-path' });
  scan(await readFile(new URL(`../${file}`, import.meta.url)), `working:${file}`);
}
// Filenames removed in earlier revisions also matter to a public repository.
for (const [sha, filename] of paths) if (forbidden.test(filename)) findings.push({ location: `git:${sha.slice(0, 12)}:${filename}`, category: 'historical-private-file-path' });
console.log(JSON.stringify({ trackedFiles: files.length, allLocalGitBlobs: blobs, allLocalGitCommits: commits, findings }, null, 2));
if (findings.length) process.exitCode = 1;
