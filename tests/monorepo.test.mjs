import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Ajv from 'ajv';
import YAML from 'yaml';
import { renderFixture, renderTemplate, root } from '../scripts/render.mjs';
import { bumpImageTag, exists, files, loadTemplate, read, reservedNames, tempRoot } from './helpers.mjs';

const secretNames = ['ZOT_USER', 'ZOT_PASSWORD', 'COSIGN_PRIVATE_KEY', 'COSIGN_PASSWORD'];
const sourceOf = (...parts) => fs.readFileSync(path.join(root, 'skeletons', ...parts));

describe('rendered monorepo skeleton', () => {
  let go;
  let python;
  let goApp;
  let pythonApp;
  let outRoot;

  before(() => {
    outRoot = tempRoot();
    go = renderFixture('monorepo-go-full', outRoot);
    python = renderFixture('monorepo-python-minimal', outRoot);
    goApp = path.join(go.outDir, 'app');
    pythonApp = path.join(python.outDir, 'app');
  });

  after(() => {
    fs.rmSync(outRoot, { recursive: true, force: true });
  });

  it('renders the three skeletons and the platform values only with deployDev', () => {
    assert.deepEqual(go.steps, ['fetch-api', 'fetch-web', 'fetch-root', 'fetch-platform-api', 'fetch-platform-web']);
    assert.deepEqual(python.steps, ['fetch-api', 'fetch-web', 'fetch-root']);
    assert.deepEqual(go.skipped, []);
    assert.deepEqual(python.skipped, []);
    assert.ok(exists(go.outDir, 'platform', 'apps', 'hello-mono-api', 'values.yaml'));
    assert.ok(exists(go.outDir, 'platform', 'apps', 'hello-mono-web', 'values.yaml'));
    assert.equal(exists(python.outDir, 'platform'), false);
  });

  it('puts the api skeleton of the chosen language under services/api', () => {
    assert.ok(exists(goApp, 'services', 'api', 'go.mod'));
    assert.equal(exists(goApp, 'services', 'api', 'pyproject.toml'), false);
    assert.ok(exists(pythonApp, 'services', 'api', 'pyproject.toml'));
    assert.equal(exists(pythonApp, 'services', 'api', 'go.mod'), false);
    for (const app of [goApp, pythonApp]) {
      assert.ok(exists(app, 'services', 'web', 'package.json'));
    }
  });

  it('keeps one workflow and one renovate config, at the root', () => {
    for (const app of [goApp, pythonApp]) {
      assert.ok(exists(app, '.github', 'workflows', 'ci.yml'));
      assert.ok(read(app, 'renovate.json') === read(root, 'skeletons', '_shared', 'ci', 'renovate.json'));
      const nested = files(path.join(app, 'services')).filter((file) => {
        const relative = path.relative(path.join(app, 'services'), file);
        return relative.split(path.sep).includes('.github') || path.basename(file) === 'renovate.json';
      });
      assert.deepEqual(nested, []);
    }
  });

  it('keeps the lock files byte for byte', () => {
    assert.ok(fs.readFileSync(path.join(pythonApp, 'services', 'api', 'uv.lock')).equals(sourceOf('back-python', 'uv.lock')));
    for (const app of [goApp, pythonApp]) {
      assert.ok(fs.readFileSync(path.join(app, 'services', 'web', 'package-lock.json')).equals(sourceOf('front-react', 'package-lock.json')));
    }
  });

  it('tells the monorepo CI which services exist and where they live', () => {
    for (const [app, language] of [[goApp, 'go'], [pythonApp, 'python']]) {
      const { jobs } = YAML.parse(read(app, '.github', 'workflows', 'ci.yml'));
      assert.equal(jobs.test.uses, 'as-platform/ci-templates/.github/workflows/monorepo-ci.yml@main');
      const services = JSON.parse(jobs.test.with.services);
      assert.deepEqual(services, [
        { name: 'api', path: 'services/api', language },
        { name: 'web', path: 'services/web', language: 'node' },
      ]);
      for (const service of services) {
        assert.ok(exists(app, service.path), service.path);
      }
    }
  });

  it('builds and deploys a service only when it changed', () => {
    const { jobs } = YAML.parse(read(goApp, '.github', 'workflows', 'ci.yml'));
    assert.deepEqual(Object.keys(jobs), ['test', 'security', 'image-api', 'image-web', 'deploy-api', 'deploy-web']);
    for (const service of ['api', 'web']) {
      const image = jobs[`image-${service}`];
      assert.deepEqual(image.needs, ['test', 'security']);
      assert.equal(image.if, `contains(fromJSON(needs.test.outputs.selected).*.name, '${service}')`);
      assert.equal(image.with.name, `hello-mono-${service}`);
      assert.equal(image.with.context, `services/${service}`);
      assert.deepEqual(Object.keys(image.secrets), secretNames);

      const deploy = jobs[`deploy-${service}`];
      assert.equal(deploy.needs, `image-${service}`);
      assert.equal(deploy.if, "github.event_name == 'push'");
      assert.equal(deploy.with.app, `hello-mono-${service}`);
      assert.equal(deploy.with.tag, `\${{ needs.image-${service}.outputs.tag }}`);
      assert.deepEqual(deploy.secrets, { PLATFORM_TOKEN: '${{ secrets.PLATFORM_TOKEN }}' });
    }
    for (const job of Object.values(jobs)) {
      assert.match(job.uses, /^as-platform\/ci-templates\/\.github\/workflows\/[a-z-]+\.yml@main$/);
    }
  });

  it('never passes all secrets and drops the deploy jobs without deployDev', () => {
    for (const app of [goApp, pythonApp]) {
      assert.doesNotMatch(read(app, '.github', 'workflows', 'ci.yml'), /secrets:\s*inherit/);
    }
    const { jobs } = YAML.parse(read(pythonApp, '.github', 'workflows', 'ci.yml'));
    assert.deepEqual(Object.keys(jobs), ['test', 'security', 'image-api', 'image-web']);
  });

  it('describes the system and its two components in the catalog', () => {
    const documents = YAML.parseAllDocuments(read(goApp, 'catalog-info.yaml')).map((document) => document.toJS());
    assert.deepEqual(documents.map((document) => document.kind), ['System', 'Location']);
    assert.equal(documents[0].metadata.name, 'hello-mono');
    assert.equal(documents[0].spec.owner, 'group:default/platform');
    for (const target of documents[1].spec.targets) {
      assert.ok(exists(goApp, target), target);
    }

    const api = YAML.parse(read(goApp, 'services', 'api', 'catalog-info.yaml'));
    const web = YAML.parse(read(goApp, 'services', 'web', 'catalog-info.yaml'));
    assert.equal(api.metadata.name, 'hello-mono-api');
    assert.equal(web.metadata.name, 'hello-mono-web');
    assert.equal(api.spec.type, 'service');
    assert.equal(web.spec.type, 'website');
    for (const component of [api, web]) {
      assert.equal(component.spec.system, 'hello-mono');
      assert.equal(component.metadata.annotations['github.com/project-slug'], 'as-platform/hello-mono');
      assert.equal(component.metadata.annotations['argocd/app-name'], component.metadata.name);
    }
  });

  it('leaves the pipeline sections out of the service readmes', () => {
    for (const service of ['api', 'web']) {
      assert.doesNotMatch(read(goApp, 'services', service, 'README.md'), /^## CI$/m);
    }
    const root = read(goApp, 'README.md');
    for (const host of ['hello-mono-api.homelab', 'hello-mono-web.homelab']) {
      assert.ok(root.includes(host), host);
    }
    assert.match(root, /^## CI$/m);
    assert.match(root, /^## First deploy$/m);
    assert.doesNotMatch(read(pythonApp, 'README.md'), /^## First deploy$/m);
  });

  it('renders one values file per application in the format bump-image-tag expects', () => {
    for (const service of ['api', 'web']) {
      const file = path.join(go.outDir, 'platform', 'apps', `hello-mono-${service}`, 'values.yaml');
      const values = YAML.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(values.image.repository, `zot.homelab/apps/hello-mono-${service}`);
      assert.equal(values.image.tag, 'bootstrap');
      assert.equal(values.ingress.host, `hello-mono-${service}.homelab`);
      assert.equal(values.resources, undefined);

      const bumped = spawnSync('awk', ['-v', 'tag=sha-abc1234', bumpImageTag, file], { encoding: 'utf8' });
      assert.equal(bumped.status, 0);
      assert.equal(YAML.parse(bumped.stdout).image.tag, 'sha-abc1234');
    }
  });

  it('gives only a python api the larger memory limit', () => {
    const { file } = loadTemplate('monorepo');
    const parameters = { name: 'py-mono', owner: 'group:default/platform', description: 'x', apiLanguage: 'python', deployDev: true };
    const outDir = path.join(outRoot, 'python-deploy');
    renderTemplate(file, parameters, outDir);
    const api = YAML.parse(read(outDir, 'platform', 'apps', 'py-mono-api', 'values.yaml'));
    const web = YAML.parse(read(outDir, 'platform', 'apps', 'py-mono-web', 'values.yaml'));
    assert.deepEqual(api.resources, { limits: { memory: '256Mi' } });
    assert.equal(web.resources, undefined);
  });
});

describe('monorepo form', () => {
  const monorepo = loadTemplate('monorepo').template;
  const backGo = loadTemplate('back-go').template;
  const nameOf = (template) => template.spec.parameters[0].properties.name;

  it('differs from the service templates only in the name length', () => {
    const { pattern: monorepoPattern, description: monorepoDescription, ...monorepoRest } = nameOf(monorepo);
    const { pattern: goPattern, description: goDescription, ...goRest } = nameOf(backGo);
    assert.deepEqual(monorepoRest, goRest);
    assert.notEqual(monorepoPattern, goPattern);
    assert.notEqual(monorepoDescription, goDescription);
  });

  it('keeps both derived application names valid for the service name schema', () => {
    const page = monorepo.spec.parameters[0];
    const accepts = new Ajv({ strict: false }).compile({ type: 'object', properties: { name: nameOf(backGo) } });
    const own = new Ajv({ strict: false }).compile({ type: 'object', properties: { name: nameOf(monorepo) } });
    for (const name of ['abc', 'hello-mono', 'a'.repeat(28), 'kubex', 'my-kube']) {
      assert.equal(own({ name }), true, name);
    }
    const candidates = [
      ...reservedNames,
      'kube',
      'kubex',
      'kube-x',
      'as-platform',
      'abc',
      'hello-mono',
      ...Array.from({ length: 26 }, (_, index) => 'a'.repeat(index + 3)),
    ];
    for (const name of candidates) {
      if (own({ name })) {
        for (const suffix of ['api', 'web']) {
          assert.equal(accepts({ name: `${name}-${suffix}` }), true, `${name}-${suffix}`);
        }
      }
    }
    for (const name of ['kube', 'kube-x', 'as-platform', 'a'.repeat(29), ...reservedNames]) {
      assert.equal(own({ name }), false, name);
    }
    assert.deepEqual([...page.required].sort(), ['description', 'name', 'owner']);
  });

  it('offers go and python for the api with go as the default', () => {
    const language = monorepo.spec.parameters[0].properties.apiLanguage;
    assert.deepEqual(language.enum, ['go', 'python']);
    assert.equal(language.default, 'go');
  });

  it('registers the root catalog file of the new repository', () => {
    const register = monorepo.spec.steps.find((step) => step.action === 'catalog:register');
    assert.equal(register.input.catalogInfoPath, '/catalog-info.yaml');
  });

  it('puts both platform values into the single pull request', () => {
    const ids = monorepo.spec.steps.map((step) => step.id);
    const pull = ids.indexOf('platform-pr');
    assert.ok(ids.indexOf('fetch-platform-api') < pull);
    assert.ok(ids.indexOf('fetch-platform-web') < pull);
    for (const id of ['fetch-platform-api', 'fetch-platform-web']) {
      const step = monorepo.spec.steps.find((candidate) => candidate.id === id);
      assert.equal(step.input.targetPath, './platform');
      assert.equal(step.if, '${{ parameters.deployDev }}');
    }
  });
});
