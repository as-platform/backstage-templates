import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import YAML from 'yaml';
import { renderFixture, root } from '../scripts/render.mjs';
import { bumpImageTag, read } from './helpers.mjs';

describe('rendered back-python skeleton', () => {
  let full;
  let minimal;
  let app;

  before(() => {
    full = renderFixture('back-python-full');
    minimal = renderFixture('back-python-minimal');
    app = path.join(full.outDir, 'app');
  });

  it('runs the platform step only with deployDev', () => {
    assert.deepEqual(full.steps, ['fetch-app', 'fetch-ci', 'fetch-platform']);
    assert.deepEqual(minimal.steps, ['fetch-app', 'fetch-ci']);
    assert.ok(fs.existsSync(path.join(full.outDir, 'platform', 'apps', 'hello-py', 'values.yaml')));
    assert.equal(fs.existsSync(path.join(minimal.outDir, 'platform')), false);
  });

  it('keeps the lock file byte for byte', () => {
    const source = fs.readFileSync(path.join(root, 'skeletons', 'back-python', 'uv.lock'));
    assert.ok(fs.readFileSync(path.join(app, 'uv.lock')).equals(source));
  });

  it('fixes the project name and the python minor', () => {
    const pyproject = read(app, 'pyproject.toml');
    assert.match(pyproject, /^name = "app"$/m);
    assert.match(pyproject, /^requires-python = ">=3\.13"$/m);
    assert.equal(read(app, '.python-version').trim(), '3.13');
    assert.doesNotMatch(pyproject, /hello-py/);
  });

  it('renders the service name into code and metadata', () => {
    assert.match(read(app, 'app', 'main.py'), /^SERVICE = "hello-py"$/m);
    const catalog = YAML.parse(read(app, 'catalog-info.yaml'));
    assert.equal(catalog.metadata.name, 'hello-py');
    assert.equal(catalog.metadata.description, 'Hello: world');
    assert.equal(catalog.spec.type, 'service');
    assert.equal(catalog.metadata.annotations['github.com/project-slug'], 'as-platform/hello-py');
    assert.equal(catalog.metadata.annotations['argocd/app-name'], 'hello-py');
  });

  it('wires the workflow jobs for python', () => {
    const { jobs } = YAML.parse(read(app, '.github', 'workflows', 'ci.yml'));
    assert.deepEqual(Object.keys(jobs), ['python', 'security', 'image', 'deploy']);
    assert.equal(jobs.python.uses, 'as-platform/ci-templates/.github/workflows/python-ci.yml@main');
    assert.deepEqual(jobs.python.with, { 'python-version': '3.13' });
    assert.deepEqual(jobs.image.needs, ['python', 'security']);
    assert.equal(jobs.image.with.name, 'hello-py');
    assert.deepEqual(Object.keys(jobs.image.secrets), ['ZOT_USER', 'ZOT_PASSWORD', 'COSIGN_PRIVATE_KEY', 'COSIGN_PASSWORD']);
    assert.equal(jobs.deploy.with.app, 'hello-py');
    assert.deepEqual(jobs.deploy.secrets, { PLATFORM_TOKEN: '${{ secrets.PLATFORM_TOKEN }}' });
  });

  it('never passes all secrets to reusable workflows and drops deploy without deployDev', () => {
    for (const { outDir } of [full, minimal]) {
      assert.doesNotMatch(read(outDir, 'app', '.github', 'workflows', 'ci.yml'), /secrets:\s*inherit/);
    }
    const { jobs } = YAML.parse(read(minimal.outDir, 'app', '.github', 'workflows', 'ci.yml'));
    assert.deepEqual(Object.keys(jobs), ['python', 'security', 'image']);
  });

  it('builds on the golden python images and runs as a numeric user', () => {
    const dockerfile = read(app, 'Dockerfile');
    assert.match(dockerfile, /^FROM zot\.homelab\/golden\/python-base:stable AS build$/m);
    assert.match(dockerfile, /^FROM zot\.homelab\/golden\/runtime:python$/m);
    assert.match(dockerfile, /^USER 65532:65532$/m);
    assert.match(dockerfile, /^ENTRYPOINT \["\/usr\/bin\/python3\.13", "-m", "app"\]$/m);
    assert.match(dockerfile, /UV_NO_BUILD=1/);
    assert.match(dockerfile, /COPY --chown=app:app pyproject\.toml uv\.lock \.\//);
  });

  it('keeps the image context free of development files', () => {
    const ignored = read(app, '.dockerignore').split('\n');
    for (const entry of ['.git', '.github', '.venv', 'tests']) {
      assert.ok(ignored.includes(entry), entry);
    }
  });

  it('renders platform values with a larger memory limit and the image block bump-image-tag expects', () => {
    const file = path.join(full.outDir, 'platform', 'apps', 'hello-py', 'values.yaml');
    const values = YAML.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(values.image.repository, 'zot.homelab/apps/hello-py');
    assert.equal(values.image.tag, 'bootstrap');
    assert.equal(values.ingress.host, 'hello-py.homelab');
    assert.deepEqual(values.resources, { limits: { memory: '256Mi' } });

    const bumped = spawnSync('awk', ['-v', 'tag=sha-abc1234', bumpImageTag, file], { encoding: 'utf8' });
    assert.equal(bumped.status, 0);
    const result = YAML.parse(bumped.stdout);
    assert.equal(result.image.tag, 'sha-abc1234');
    assert.deepEqual(result.resources, { limits: { memory: '256Mi' } });
  });
});
