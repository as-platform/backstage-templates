import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import YAML from 'yaml';
import { renderFixture, root } from '../scripts/render.mjs';
import { bumpImageTag, read, tempRoot } from './helpers.mjs';

describe('rendered front-react skeleton', () => {
  let full;
  let minimal;
  let app;
  let outRoot;

  before(() => {
    outRoot = tempRoot();
    full = renderFixture('front-react-full', outRoot);
    minimal = renderFixture('front-react-minimal', outRoot);
    app = path.join(full.outDir, 'app');
  });

  after(() => {
    fs.rmSync(outRoot, { recursive: true, force: true });
  });

  it('runs the platform step only with deployDev', () => {
    assert.deepEqual(full.steps, ['fetch-app', 'fetch-ci', 'fetch-platform']);
    assert.deepEqual(minimal.steps, ['fetch-app', 'fetch-ci']);
    assert.ok(fs.existsSync(path.join(full.outDir, 'platform', 'apps', 'hello-web', 'values.yaml')));
    assert.equal(fs.existsSync(path.join(minimal.outDir, 'platform')), false);
  });

  it('keeps the lock file byte for byte', () => {
    const source = fs.readFileSync(path.join(root, 'skeletons', 'front-react', 'package-lock.json'));
    assert.ok(fs.readFileSync(path.join(app, 'package-lock.json')).equals(source));
  });

  it('fixes the package name and exposes the scripts node-ci runs', () => {
    const pkg = JSON.parse(read(app, 'package.json'));
    assert.equal(pkg.name, 'web');
    for (const script of ['lint', 'typecheck', 'test', 'build', 'start']) {
      assert.ok(pkg.scripts[script], script);
    }
    assert.doesNotMatch(read(app, 'package.json'), /hello-web/);
  });

  it('pins every dependency to an exact version', () => {
    const pkg = JSON.parse(read(app, 'package.json'));
    for (const version of Object.values({ ...pkg.dependencies, ...pkg.devDependencies })) {
      assert.match(version, /^\d+\.\d+\.\d+$/);
    }
    assert.match(read(app, '.npmrc'), /^save-exact=true$/m);
    assert.match(read(app, '.npmrc'), /^min-release-age=7$/m);
  });

  it('renders the service name into the page and metadata', () => {
    assert.match(read(app, 'src', 'App.tsx'), /^export const SERVICE = 'hello-web';$/m);
    assert.match(read(app, 'index.html'), /<title>hello-web<\/title>/);
    const catalog = YAML.parse(read(app, 'catalog-info.yaml'));
    assert.equal(catalog.metadata.name, 'hello-web');
    assert.equal(catalog.spec.type, 'website');
    assert.equal(catalog.metadata.annotations['github.com/project-slug'], 'as-platform/hello-web');
    assert.equal(catalog.metadata.annotations['argocd/app-name'], 'hello-web');
  });

  it('wires the workflow jobs for node', () => {
    const { jobs } = YAML.parse(read(app, '.github', 'workflows', 'ci.yml'));
    assert.deepEqual(Object.keys(jobs), ['node', 'security', 'image', 'deploy']);
    assert.equal(jobs.node.uses, 'as-platform/ci-templates/.github/workflows/node-ci.yml@main');
    assert.equal(jobs.node.with, undefined);
    assert.deepEqual(jobs.image.needs, ['node', 'security']);
    assert.equal(jobs.image.with.name, 'hello-web');
    assert.deepEqual(jobs.deploy.secrets, { PLATFORM_TOKEN: '${{ secrets.PLATFORM_TOKEN }}' });
  });

  it('never passes all secrets to reusable workflows and drops deploy without deployDev', () => {
    for (const { outDir } of [full, minimal]) {
      assert.doesNotMatch(read(outDir, 'app', '.github', 'workflows', 'ci.yml'), /secrets:\s*inherit/);
    }
    const { jobs } = YAML.parse(read(minimal.outDir, 'app', '.github', 'workflows', 'ci.yml'));
    assert.deepEqual(Object.keys(jobs), ['node', 'security', 'image']);
  });

  it('builds on the golden node images, ships no node_modules and runs as a numeric user', () => {
    const dockerfile = read(app, 'Dockerfile');
    assert.match(dockerfile, /^FROM zot\.homelab\/golden\/node-builder:stable AS build$/m);
    assert.match(dockerfile, /^FROM zot\.homelab\/golden\/runtime:node$/m);
    assert.match(dockerfile, /^RUN npm ci$/m);
    assert.match(dockerfile, /^USER 65532:65532$/m);
    assert.match(dockerfile, /^CMD \["server\/server\.mjs"\]$/m);
    const runtime = dockerfile.slice(dockerfile.indexOf('golden/runtime:node'));
    assert.doesNotMatch(runtime, /node_modules/);
  });

  it('keeps the image context free of build output and dependencies', () => {
    const ignored = read(app, '.dockerignore').split('\n');
    for (const entry of ['.git', '.github', 'node_modules', 'dist']) {
      assert.ok(ignored.includes(entry), entry);
    }
  });

  it('keeps the default resources and bumps the tag in platform values', () => {
    const file = path.join(full.outDir, 'platform', 'apps', 'hello-web', 'values.yaml');
    const values = YAML.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(values.image.repository, 'zot.homelab/apps/hello-web');
    assert.equal(values.image.tag, 'bootstrap');
    assert.equal(values.ingress.host, 'hello-web.homelab');
    assert.equal(values.resources, undefined);

    const bumped = spawnSync('awk', ['-v', 'tag=sha-abc1234', bumpImageTag, file], { encoding: 'utf8' });
    assert.equal(bumped.status, 0);
    assert.equal(YAML.parse(bumped.stdout).image.tag, 'sha-abc1234');
  });
});
