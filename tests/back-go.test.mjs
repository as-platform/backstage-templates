import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { templateEntityV1beta3Validator } from '@backstage/plugin-scaffolder-common';
import Ajv from 'ajv';
import YAML from 'yaml';
import { renderFixture, root } from '../scripts/render.mjs';

const templateFile = path.join(root, 'scaffolder', 'back-go', 'template.yaml');
const templateText = fs.readFileSync(templateFile, 'utf8');
const template = YAML.parse(templateText);

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');
const exists = (...parts) => fs.existsSync(path.join(...parts));
const files = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));

const conventionalCommit = /^(feat|fix|refactor|perf|docs|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: [a-z].*[^.]$/;

const bumpImageTag = String.raw`
  /^image:/ { in_image = 1; print; next }
  in_image && /^[^[:space:]#]/ { in_image = 0 }
  in_image && /^[[:space:]]+tag:/ { sub(/tag:.*/, "tag: \"" tag "\""); done = 1 }
  { print }
  END { if (!done) exit 3 }
`;

describe('template.yaml', () => {
  it('is a valid Template.v1beta3 entity', async () => {
    assert.equal(await templateEntityV1beta3Validator.check(template), true);
  });

  it('has unique step ids and resolvable references', () => {
    const ids = template.spec.steps.map((step) => step.id);
    assert.equal(new Set(ids).size, ids.length);
    const stepRefs = [...templateText.matchAll(/steps\['([^']+)'\]/g)].map((match) => match[1]);
    for (const ref of stepRefs) {
      assert.ok(ids.includes(ref), `unknown step ${ref}`);
    }
    const formFields = template.spec.parameters.flatMap((page) => Object.keys(page.properties));
    const parameterRefs = [...templateText.matchAll(/parameters\.(\w+)/g)].map((match) => match[1]);
    for (const ref of parameterRefs) {
      assert.ok(formFields.includes(ref), `unknown parameter ${ref}`);
    }
  });

  it('points fetch:template at existing skeletons', () => {
    const fetches = template.spec.steps.filter((step) => step.action === 'fetch:template');
    assert.ok(fetches.length > 0);
    for (const step of fetches) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(templateFile), step.input.url)), step.input.url);
    }
  });

  it('creates private repositories only', () => {
    const publish = template.spec.steps.find((step) => step.action === 'publish:github');
    assert.equal(publish.input.repoVisibility, 'private');
    assert.doesNotMatch(JSON.stringify(template.spec.parameters), /repoVisibility/);
  });

  it('writes conventional commit subjects without AI attribution', () => {
    const publish = template.spec.steps.find((step) => step.action === 'publish:github');
    const pull = template.spec.steps.find((step) => step.action === 'publish:github:pull-request');
    const subjects = [publish.input.gitCommitMessage, pull.input.commitMessage, pull.input.title];
    for (const subject of subjects) {
      const rendered = subject.replaceAll('${{ parameters.name }}', 'hello-go');
      assert.match(rendered, conventionalCommit);
      assert.ok(rendered.length <= 72, rendered);
    }
    assert.doesNotMatch(templateText, /co-authored-by|claude|anthropic|generated with/i);
  });

  it('opens the k3s pull request on a conventional branch from main', () => {
    const pull = template.spec.steps.find((step) => step.action === 'publish:github:pull-request');
    assert.match(pull.input.branchName, /^feature\/add-app-\$\{\{ parameters\.name \}\}$/);
    assert.equal(pull.input.targetBranchName, 'main');
    assert.equal(pull.input.repoUrl, 'github.com?owner=as-platform&repo=k3s');
    assert.equal(pull.if, '${{ parameters.deployDev }}');
  });

  it('limits the owner to existing catalog groups', () => {
    const owner = template.spec.parameters.flatMap((page) => Object.entries(page.properties)).find(([name]) => name === 'owner')[1];
    assert.equal(owner['ui:field'], 'OwnerPicker');
    assert.equal(owner['ui:options'].allowArbitraryValues, false);
    assert.equal(owner['ui:options'].catalogFilter.kind, 'Group');
  });

  it('gives the new repository access to the runner group right after creating it', () => {
    const publishIndex = template.spec.steps.findIndex((step) => step.action === 'publish:github');
    const publish = template.spec.steps[publishIndex];
    const access = template.spec.steps[publishIndex + 1];
    assert.equal(access?.action, 'github:runner-group:add-repo');
    assert.equal(access.input.repoUrl, publish.input.repoUrl);
  });
});

describe('form', () => {
  const page = template.spec.parameters[0];
  const validate = new Ajv({ strict: false }).compile({
    type: 'object',
    required: page.required,
    properties: page.properties,
  });
  const accepts = (name) => validate({ name, description: 'x', owner: 'group:default/platform' });

  it('accepts valid service names', () => {
    for (const name of ['hello-go', 'abc', 'my-service-2', 'a'.repeat(32)]) {
      assert.equal(accepts(name), true, name);
    }
  });

  it('rejects reserved and malformed service names', () => {
    const reserved = [
      'argocd', 'sealed-secrets', 'metallb', 'traefik', 'cert-manager', 'zot', 'keda', 'github-runner',
      'monitoring', 'backstage', 'postgres', 'kyverno', 'storage', 'default', 'podinfo', 'kube-system',
    ];
    const malformed = ['Hello', 'a', 'ab', 'x-', '-ab', '1abc', 'a_b', 'a'.repeat(33), ''];
    for (const name of [...reserved, ...malformed]) {
      assert.equal(accepts(name), false, JSON.stringify(name));
    }
  });

  it('requires name, owner and description', () => {
    assert.deepEqual([...page.required].sort(), ['description', 'name', 'owner']);
  });

  it('defaults to deploy to dev', () => {
    const deploy = template.spec.parameters[1].properties;
    assert.deepEqual(Object.keys(deploy), ['deployDev']);
    assert.equal(deploy.deployDev.default, true);
  });
});

describe('rendered skeleton', () => {
  let full;
  let minimal;

  before(() => {
    full = renderFixture('back-go-full');
    minimal = renderFixture('back-go-minimal');
  });

  it('runs the platform step only with deployDev', () => {
    assert.deepEqual(full.steps, ['fetch-app', 'fetch-platform']);
    assert.deepEqual(minimal.steps, ['fetch-app']);
    assert.ok(exists(full.outDir, 'platform', 'apps', 'hello-go', 'values.yaml'));
    assert.equal(exists(minimal.outDir, 'platform'), false);
  });

  it('leaves no template syntax behind', () => {
    for (const { outDir } of [full, minimal]) {
      for (const file of files(outDir)) {
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\$\{\{\s*(values|parameters)\.|\{%|\{#/, file);
      }
    }
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
