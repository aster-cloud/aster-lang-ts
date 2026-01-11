#!/usr/bin/env node
// Open a GitHub Pull Request using the REST API.
// Requires: GITHUB_TOKEN (or GH_TOKEN) with repo scope.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function parseRemote(url) {
  // Supports: https://github.com/owner/repo.git and git@github.com:owner/repo.git
  const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  throw new Error(`Unsupported remote URL: ${url}`);
}

function parseArgs(argv) {
  const args = { base: 'main', head: null, title: null, body: null, draft: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--base') args.base = next();
    else if (a.startsWith('--base=')) args.base = a.split('=', 2)[1];
    else if (a === '--head') args.head = next();
    else if (a.startsWith('--head=')) args.head = a.split('=', 2)[1];
    else if (a === '--title') args.title = next();
    else if (a.startsWith('--title=')) args.title = a.split('=', 2)[1];
    else if (a === '--body') args.body = next();
    else if (a.startsWith('--body=')) args.body = a.split('=', 2)[1];
    else if (a === '--bodyfile') args.body = fs.readFileSync(next(), 'utf8');
    else if (a.startsWith('--bodyfile=')) args.body = fs.readFileSync(a.split('=', 2)[1], 'utf8');
    else if (a === '--draft') args.draft = true;
  }
  return args;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error('Error: Set GITHUB_TOKEN (or GH_TOKEN) with repo scope.');
    process.exit(2);
  }

  let owner, repo;
  if (process.env.GITHUB_REPOSITORY) {
    [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  } else {
    const remoteUrl = sh('git config --get remote.origin.url');
    ({ owner, repo } = parseRemote(remoteUrl));
  }

  const currentBranch = sh('git rev-parse --abbrev-ref HEAD');
  const args = parseArgs(process.argv.slice(2));
  const head = args.head || currentBranch;
  const base = args.base || 'main';
  const title = args.title || `chore: open PR for ${head}`;
  let body = args.body;

  if (!body) {
    const templatePath = '.github/pull_request_template.md';
    if (fs.existsSync(templatePath)) body = fs.readFileSync(templatePath, 'utf8');
  }
  if (!body) body = `Automated PR for branch '${head}'.`;

  const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
  const payload = { title, head, base, body, maintainer_can_modify: true, draft: !!args.draft };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 422) {
    // PR may already exist; try to find it
    const qs = new URLSearchParams({ head: `${owner}:${head}`, state: 'open' }).toString();
    const listUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?${qs}`;
    const listRes = await fetch(listUrl, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    });
    const prs = await listRes.json();
    if (Array.isArray(prs) && prs.length > 0) {
      console.log(`PR already exists: ${prs[0].html_url}`);
      process.exit(0);
    }
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to create PR: ${res.status} ${res.statusText}\n${text}`);
    process.exit(1);
  }

  const pr = await res.json();
  console.log(`PR created: ${pr.html_url}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
