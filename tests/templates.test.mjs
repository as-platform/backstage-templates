import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { templateEntityV1beta3Validator } from '@backstage/plugin-scaffolder-common';
import Ajv from 'ajv';
import { renderFixture, root } from '../scripts/render.mjs';
import {
  conventionalCommit,
  files,
  implementedTemplates,
  loadTemplate,
  reservedNames,
  serviceTemplates,
  tempRoot,
} from './helpers.mjs';

const longestName = 'a'.repeat(32);

const withoutComments = new Set([
  'uv.lock', 'go.sum', 'go.mod', 'package-lock.json', '.python-version', 'renovate.json', 'catalog-info.json',
]);
const suppression = /noqa|nosec|nosemgrep|type:\s*ignore|eslint-disable|nolint|@ts-ignore|@ts-expect-error/;

const hashComment = /(^|\s)#/m;
const slashComment = /(^|\s)\/\/|\/\*/m;
const blockComment = /\/\*/;
const markupComment = /<!--/;

const commentPattern = (base) => {
  if (withoutComments.has(base) || /\.(json|md)$/.test(base)) {
    return null;
  }
  if (base === 'Dockerfile' || ['.gitignore', '.dockerignore', '.npmrc'].includes(base) || /\.(py|toml|ya?ml)$/.test(base)) {
    return hashComment;
  }
  if (/\.(go|ts|tsx|js|mjs|cjs)$/.test(base)) {
    return slashComment;
  }
  if (base.endsWith('.css')) {
    return blockComment;
  }
  if (base.endsWith('.html')) {
    return markupComment;
  }
  throw new Error(`no comment rule for ${base}: add one in templates.test.mjs`);
};

const properties = (template) => Object.assign({}, ...template.spec.parameters.map((page) => page.properties));

for (const name of serviceTemplates) {
  const { file, text, template } = loadTemplate(name);

  describe(`${name} template.yaml`, () => {
    it('is a valid Template.v1beta3 entity', async () => {
      assert.equal(await templateEntityV1beta3Validator.check(template), true);
    });

    it('has unique step ids and resolvable references', () => {
      const ids = template.spec.steps.map((step) => step.id);
      assert.equal(new Set(ids).size, ids.length);
      const stepRefs = [...text.matchAll(/steps\['([^']+)'\]/g)].map((match) => match[1]);
      for (const ref of stepRefs) {
        assert.ok(ids.includes(ref), `unknown step ${ref}`);
      }
      const formFields = Object.keys(properties(template));
      const parameterRefs = [...text.matchAll(/parameters\.(\w+)/g)].map((match) => match[1]);
      for (const ref of parameterRefs) {
        assert.ok(formFields.includes(ref), `unknown parameter ${ref}`);
      }
    });

    it('points fetch:template at existing skeletons', () => {
      const fetches = template.spec.steps.filter((step) => step.action === 'fetch:template');
      assert.ok(fetches.length > 0);
      for (const step of fetches) {
        assert.ok(fs.existsSync(path.resolve(path.dirname(file), step.input.url)), step.input.url);
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
        const rendered = subject.replaceAll('${{ parameters.name }}', longestName);
        assert.match(rendered, conventionalCommit);
        assert.ok(rendered.length <= 72, rendered);
      }
      assert.doesNotMatch(text, /co-authored-by|claude|anthropic|generated with/i);
    });

    it('opens the k3s pull request on a conventional branch from main', () => {
      const pull = template.spec.steps.find((step) => step.action === 'publish:github:pull-request');
      assert.match(pull.input.branchName, /^feature\/add-app-\$\{\{ parameters\.name \}\}$/);
      assert.ok(`feature/add-app-${longestName}`.length <= 50);
      assert.equal(pull.input.targetBranchName, 'main');
      assert.equal(pull.input.repoUrl, 'github.com?owner=as-platform&repo=k3s');
      assert.equal(pull.if, '${{ parameters.deployDev }}');
    });

    it('limits the owner to existing catalog groups', () => {
      const owner = properties(template).owner;
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

  describe(`${name} form`, () => {
    const page = template.spec.parameters[0];
    const validate = new Ajv({ strict: false }).compile({
      type: 'object',
      required: page.required,
      properties: page.properties,
    });
    const accepts = (value) => validate({ name: value, description: 'x', owner: 'group:default/platform' });

    it('accepts valid service names', () => {
      for (const value of ['hello-go', 'abc', 'my-service-2', longestName]) {
        assert.equal(accepts(value), true, value);
      }
    });

    it('rejects reserved and malformed service names', () => {
      const malformed = ['Hello', 'a', 'ab', 'x-', '-ab', '1abc', 'a_b', 'a'.repeat(33), ''];
      for (const value of [...reservedNames, ...malformed]) {
        assert.equal(accepts(value), false, JSON.stringify(value));
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
}

for (const name of serviceTemplates) {
  describe(`${name} rendered fixtures`, () => {
    let rendered;
    let outRoot;

    before(() => {
      outRoot = tempRoot();
      rendered = ['full', 'minimal'].map((kind) => renderFixture(`${name}-${kind}`, outRoot));
    });

    after(() => {
      fs.rmSync(outRoot, { recursive: true, force: true });
    });

    it('skips no file', () => {
      for (const { skipped } of rendered) {
        assert.deepEqual(skipped, []);
      }
    });

    it('carries no comments or lint suppressions', () => {
      for (const { outDir } of rendered) {
        for (const file of files(outDir)) {
          const base = path.basename(file);
          const comment = commentPattern(base);
          if (comment === null && base !== 'package-lock.json' && !withoutComments.has(base) && !base.endsWith('.md')) {
            assert.doesNotMatch(fs.readFileSync(file, 'utf8'), suppression, file);
          }
          if (comment) {
            const text = fs.readFileSync(file, 'utf8');
            assert.doesNotMatch(text, comment, file);
            assert.doesNotMatch(text, suppression, file);
          }
        }
      }
    });

    it('leaves no template syntax behind', () => {
      for (const { outDir } of rendered) {
        for (const file of files(outDir)) {
          assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\$\{\{\s*(values|parameters)\.|\{%|\{#/, file);
        }
      }
    });
  });
}

describe('service templates', () => {
  it('ship no scanner ignore files', () => {
    const ignores = files(path.join(root, 'skeletons')).filter((file) =>
      ['.trivyignore', '.trivyignore.yaml', '.semgrepignore', '.gitleaksignore', '.hadolint.yaml', '.hadolint.yml'].includes(path.basename(file)),
    );
    assert.deepEqual(ignores, []);
  });

  it('are all covered by the shared checks', () => {
    const implemented = implementedTemplates().filter((name) => name !== 'monorepo');
    assert.deepEqual(implemented.sort(), [...serviceTemplates].sort());
  });

  it('share one name schema', () => {
    const [first, ...rest] = serviceTemplates.map((name) => properties(loadTemplate(name).template).name);
    for (const schema of rest) {
      assert.deepEqual(schema, first);
    }
  });
});
