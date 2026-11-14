import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import YAML from 'yaml';
import { renderFixture } from '../scripts/render.mjs';
import { bumpImageTag, exists, read } from './helpers.mjs';

describe('rendered skeleton', () => {
  let full;
  let minimal;

  before(() => {
    full = renderFixture('back-go-full');
    minimal = renderFixture('back-go-minimal');
  });

  it('runs the platform step only with deployDev', () => {
    assert.deepEqual(full.steps, ['fetch-app', 'fetch-ci', 'fetch-platform']);
    assert.deepEqual(minimal.steps, ['fetch-app', 'fetch-ci']);
    assert.ok(exists(full.outDir, 'platform', 'apps', 'hello-go', 'values.yaml'));
    assert.equal(exists(minimal.outDir, 'platform'), false);
  });

  it('renders the service name into code and metadata', () => {
    const app = path.join(full.outDir, 'app');
    assert.equal(read(app, 'go.mod').split('\n')[0], 'module github.com/as-platform/hello-go');
    assert.match(read(app, 'main.go'), /"github\.com\/as-platform\/hello-go\/internal\/server"/);
    assert.match(read(app, 'internal', 'server', 'server.go'), /"service": "hello-go"/);
    assert.ok(exists(app, 'go.sum'));
    const catalog = YAML.parse(read(app, 'catalog-info.yaml'));
    assert.equal(catalog.metadata.name, 'hello-go');
    assert.equal(catalog.metadata.description, 'Hello: world');
    assert.equal(catalog.spec.owner, 'group:default/platform');
    assert.equal(catalog.metadata.annotations['backstage.io/kubernetes-id'], 'hello-go');
    assert.equal(catalog.metadata.annotations['github.com/project-slug'], 'as-platform/hello-go');
    assert.equal(catalog.metadata.annotations['argocd/app-name'], 'hello-go');
    const { packageRules } = JSON.parse(read(app, 'renovate.json'));
    assert.deepEqual(packageRules[0].matchPackageNames, ['zot.homelab/**']);
    assert.ok(packageRules.every((rule) => rule.minimumReleaseAge === '7 days'));
  });

  it('keeps GitHub expressions in the workflow', () => {
    const text = read(full.outDir, 'app', '.github', 'workflows', 'ci.yml');
    for (const expression of [
      '${{ github.ref }}',
      "${{ github.event_name == 'pull_request' }}",
      '${{ vars.ZOT_REGISTRY }}',
      "${{ github.event_name == 'push' }}",
      '${{ needs.image.outputs.tag }}',
      '${{ secrets.ZOT_USER }}',
      '${{ secrets.ZOT_PASSWORD }}',
      '${{ secrets.COSIGN_PRIVATE_KEY }}',
      '${{ secrets.COSIGN_PASSWORD }}',
      '${{ secrets.PLATFORM_TOKEN }}',
    ]) {
      assert.ok(text.includes(expression), expression);
    }
  });

  it('wires the workflow jobs', () => {
    const { jobs } = YAML.parse(read(full.outDir, 'app', '.github', 'workflows', 'ci.yml'));
    assert.deepEqual(Object.keys(jobs), ['go', 'security', 'image', 'deploy']);
    assert.deepEqual(jobs.image.needs, ['go', 'security']);
    assert.equal(jobs.image.with.name, 'hello-go');
    assert.deepEqual(jobs.image.secrets, {
      ZOT_USER: '${{ secrets.ZOT_USER }}',
      ZOT_PASSWORD: '${{ secrets.ZOT_PASSWORD }}',
      COSIGN_PRIVATE_KEY: '${{ secrets.COSIGN_PRIVATE_KEY }}',
      COSIGN_PASSWORD: '${{ secrets.COSIGN_PASSWORD }}',
    });
    assert.equal(jobs.image.with.smoke, undefined);
    assert.equal(jobs.deploy.needs, 'image');
    assert.equal(jobs.deploy.if, "github.event_name == 'push'");
    assert.equal(jobs.deploy.with.app, 'hello-go');
    assert.equal(jobs.deploy.with['platform-repo'], 'as-platform/k3s');
    assert.equal(jobs.deploy.with.mode, 'commit');
    assert.deepEqual(jobs.deploy.secrets, { PLATFORM_TOKEN: '${{ secrets.PLATFORM_TOKEN }}' });
    for (const job of Object.values(jobs)) {
      assert.match(job.uses, /^as-platform\/ci-templates\/\.github\/workflows\/[a-z-]+\.yml@main$/);
    }
  });

  it('never passes all secrets to reusable workflows', () => {
    for (const { outDir } of [full, minimal]) {
      assert.doesNotMatch(read(outDir, 'app', '.github', 'workflows', 'ci.yml'), /secrets:\s*inherit/);
    }
  });

  it('drops the deploy job without deployDev', () => {
    const { jobs } = YAML.parse(read(minimal.outDir, 'app', '.github', 'workflows', 'ci.yml'));
    assert.deepEqual(Object.keys(jobs), ['go', 'security', 'image']);
  });

  it('renders platform values with the image block bump-image-tag expects', () => {
    const file = path.join(full.outDir, 'platform', 'apps', 'hello-go', 'values.yaml');
    const values = YAML.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(values.image.repository, 'zot.homelab/apps/hello-go');
    assert.equal(values.image.tag, 'bootstrap');
    assert.equal(values.ingress.enabled, true);
    assert.equal(values.ingress.host, 'hello-go.homelab');
    assert.equal(values.autoscaling, undefined);
    assert.equal(values.replicas, undefined);

    const bumped = spawnSync('awk', ['-v', 'tag=sha-abc1234', bumpImageTag, file], { encoding: 'utf8' });
    assert.equal(bumped.status, 0);
    assert.equal(YAML.parse(bumped.stdout).image.tag, 'sha-abc1234');
  });
});
