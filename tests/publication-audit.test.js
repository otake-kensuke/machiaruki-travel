import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { auditRepository } from '../scripts/audit-publication.mjs';

async function fixture(run) {
  const root = fileURLToPath(new URL('../test-results/', import.meta.url)); await mkdir(root, { recursive: true }); const repo = await mkdtemp(path.join(root, 'audit-fixture-'));
  const git = (args, input) => { const result = spawnSync('git', args, { cwd: repo, input, encoding: 'utf8' }); if (result.status !== 0) throw new Error('Audit fixture command failed'); return result.stdout.trim(); };
  try {
    git(['init', '-b', 'main']); git(['config', 'user.name', 'audit-fixture']); git(['config', 'user.email', ['audit-fixture', 'users.noreply.github.com'].join('@')]);
    await writeFile(path.join(repo, 'README.md'), 'Fictional audit fixture\n'); git(['add', 'README.md']); git(['commit', '-m', 'Safe fixture']);
    // Metadata-only PNG probe: no personal image or actual EXIF values.
    const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from([0,0,0,0]), Buffer.from('eXIf'), Buffer.alloc(4)]);
    const blob = git(['hash-object', '-w', '--stdin'], png);
    const tree = git(['mktree'], `100644 blob ${blob}\t20261020_120000_iOS.png\n`);
    await run({ git, repo, tree });
  } finally {
    const relative = path.relative(path.resolve(root), path.resolve(repo)); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Fixture outside test-results');
    await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
test('ローカルCodexツリーの画像は公開履歴と区別し、既定の全ローカル監査では警告する', async () => fixture(async ({ git, repo, tree }) => {
  git(['update-ref', 'refs/codex/test-tree', tree]);
  const strict = await auditRepository(repo); assert.ok(strict.findings.some(row => row.category === 'image-metadata'));
  const publication = await auditRepository(repo, { publicationOnly: true }); assert.deepEqual(publication.findings, []); assert.ok(publication.localOnlyFindings.some(row => row.category === 'image-metadata'));
}));
test('同じ画像が一度でもmainの履歴に入れば削除後も公開監査が拒否する', async () => fixture(async ({ git, repo, tree }) => {
  const original = git(['rev-parse', 'HEAD']); const safeTree = git(['rev-parse', 'HEAD^{tree}']);
  const exposed = git(['commit-tree', tree, '-p', original, '-m', 'Historical private fixture']);
  const removed = git(['commit-tree', safeTree, '-p', exposed, '-m', 'Remove private fixture']);
  const sharedBlob = git(['rev-parse', `${original}:README.md`]);
  const aliasTree = git(['mktree'], `100644 blob ${sharedBlob}\t.private.json\n100644 blob ${sharedBlob}\tREADME.md\n`);
  const alias = git(['commit-tree', aliasTree, '-p', removed, '-m', 'Same blob under private name']);
  const clean = git(['commit-tree', safeTree, '-p', alias, '-m', 'Remove private alias']); git(['update-ref', 'refs/heads/main', clean]);
  const publication = await auditRepository(repo, { publicationOnly: true });
  assert.ok(publication.findings.some(row => row.category === 'image-metadata')); assert.ok(publication.findings.some(row => row.category === 'historical-private-file-path'));
  assert.ok(publication.findings.some(row => row.location === 'historical:.private.json'));
}));
