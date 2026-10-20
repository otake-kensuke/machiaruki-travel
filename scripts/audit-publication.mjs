import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Read-only local audit. Print locations/categories, never matched credential values.
function git(root, args, binary = false) {
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
function scan(buffer, location, findings) {
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
export async function auditRepository(root, { publicationOnly = false } = {}) {
  const run = (args, binary) => git(root, args, binary);
  const objectPaths = text => new Map(text.trim().split('\n').filter(Boolean).map(line => { const split = line.indexOf(' '); return split < 0 ? [line, ''] : [line.slice(0, split), line.slice(split + 1)]; }));
  const paths = objectPaths(run(['rev-list', '--objects', '--all', '--reflog']));
  // Audit every public-capable branch/tag, its complete history, HEAD and the index.
  // Codex's private tree snapshots are not sent by `git push origin main`.
  const refs = run(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags']).trim().split('\n').filter(Boolean);
  const publication = objectPaths(run(['rev-list', '--objects', 'HEAD', ...refs]));
  for (const entry of run(['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
    const match = entry.match(/^\d+ ([a-f0-9]+) \d+\t([\s\S]+)$/); if (match) publication.set(match[1], match[2]);
  }
  const publishedFindings = []; const localOnlyFindings = [];
  const objects = run(['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)']).trim().split('\n').map(line => line.split(' '));
  let blobs = 0; let commits = 0;
  for (const [sha, type] of objects) {
    const findings = publication.has(sha) ? publishedFindings : localOnlyFindings;
    if (type === 'blob') { blobs++; scan(run(['cat-file', 'blob', sha], true), `git:${sha.slice(0, 12)}:${paths.get(sha) || publication.get(sha) || '(unreferenced)'}`, findings); }
    if (type === 'commit') {
      commits++; const commit = run(['cat-file', 'commit', sha]);
      for (const line of commit.split('\n').filter(value => /^(author|committer) /.test(value))) {
        if (!/<[^<>]+@users\.noreply\.github\.com>/.test(line)) findings.push({ location: `commit:${sha.slice(0, 12)}`, category: 'review-author-identity' });
      }
      scan(Buffer.from(commit.split('\n\n').slice(1).join('\n\n')), `commit-message:${sha.slice(0, 12)}`, findings);
    }
  }
  const files = run(['ls-files', '-z']).split('\0').filter(Boolean);
  const forbidden = /(?:^|\/)(?:\.env(?:\.|$)|credentials\.json$|secrets\.json$|backups?\/|exports\/|local-data\/|test-results\/|20[0-9_]+_iOS\.png$)|(?:\.backup\.json|\.personal\.json|\.private\.json|\.pem|\.p12|\.pfx)$|machiaruki-travel-(?:backup|before-restore).*\.json$/i;
  for (const file of files) {
    if (forbidden.test(file)) publishedFindings.push({ location: file, category: 'private-file-path' });
    scan(await readFile(path.join(root, file)), `working:${file}`, publishedFindings);
  }
  // Keep removed historical objects and local snapshot diagnostics in scope.
  for (const [sha, filename] of new Map([...paths, ...publication])) if (forbidden.test(filename)) (publication.has(sha) ? publishedFindings : localOnlyFindings).push({ location: `git:${sha.slice(0, 12)}:${filename}`, category: 'historical-private-file-path' });
  // A blob can appear under several names. Check all historical names independently.
  const historicalNames = new Set(run(['-c', 'core.quotePath=false', 'log', '--format=', '--name-only', 'HEAD', ...refs]).split('\n').filter(Boolean));
  for (const filename of historicalNames) if (forbidden.test(filename)) publishedFindings.push({ location: `historical:${filename}`, category: 'historical-private-file-path' });
  const unique = rows => [...new Map(rows.map(row => [`${row.location}:${row.category}`, row])).values()];
  return { scope: publicationOnly ? 'branches-tags-history-HEAD-index' : 'all-local-objects', trackedFiles: files.length, allLocalGitBlobs: blobs, allLocalGitCommits: commits,
    findings: unique(publicationOnly ? publishedFindings : [...publishedFindings, ...localOnlyFindings]), localOnlyFindings: unique(localOnlyFindings) };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const report = await auditRepository(fileURLToPath(new URL('../', import.meta.url)), { publicationOnly: process.argv.includes('--publication') });
  console.log(JSON.stringify(report, null, 2));
  if (report.findings.length) process.exitCode = 1;
}
