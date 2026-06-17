// Build locally and force-push the result to the `gh-pages` branch.
// Run: npm run deploy   (after committing any source changes you want live)
import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

console.log('› Building production bundle…');
run('npm run build', { cwd: root });

if (!existsSync(dist)) {
  console.error('dist/ missing after build.');
  process.exit(1);
}

// Tell Pages not to apply Jekyll (would hide _-prefixed files).
writeFileSync(resolve(dist, '.nojekyll'), '');
// SPA-style fallback so refresh on any path serves the app shell.
copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'));

const remote = execSync('git remote get-url origin', { cwd: root, encoding: 'utf8' }).trim();
console.log(`› Deploying to ${remote} (branch: gh-pages)…`);

const distGit = resolve(dist, '.git');
if (existsSync(distGit)) rmSync(distGit, { recursive: true, force: true });

const author = '-c user.email=jordan.avi.carmel@gmail.com -c user.name=Jordan';
const opts = { cwd: dist };
run('git init -b gh-pages', opts);
run(`git ${author} add .`, opts);
run(`git ${author} commit -m "Deploy"`, opts);
run(`git remote add origin ${remote}`, opts);
run('git push -f origin gh-pages', opts);

console.log('\n✓ Deployed. Pages will pick it up in ~30s.');
