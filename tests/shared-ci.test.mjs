import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import YAML from 'yaml';
import { renderTemplate, root } from '../scripts/render.mjs';
import { templateYaml, write } from './helpers.mjs';

const languages = ['go', 'python', 'node'];

describe('shared ci', () => {
  let dir;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-ci-'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const render = (language, deployDev) => {
    const templateFile = path.join(dir, `${language}-${deployDev}.yaml`);
    const outDir = path.join(dir, `${language}-${deployDev}`);
    write(
      templateFile,
      templateYaml([
        {
          id: 'ci',
          url: path.join(root, 'skeletons', '_shared', 'ci'),
          values: { name: 'demo', deployDev, language },
        },
      ]),
    );
    renderTemplate(templateFile, {}, outDir);
    return {
      workflow: YAML.parse(fs.readFileSync(path.join(outDir, 'app', '.github', 'workflows', 'ci.yml'), 'utf8')),
      renovate: JSON.parse(fs.readFileSync(path.join(outDir, 'app', 'renovate.json'), 'utf8')),
    };
  };

  for (const language of languages) {
    it(`names the language job after ${language} and gates the image on it`, () => {
      const { workflow } = render(language, true);
      assert.deepEqual(Object.keys(workflow.jobs), [language, 'security', 'image', 'deploy']);
      assert.equal(workflow.jobs[language].uses, `as-platform/ci-templates/.github/workflows/${language}-ci.yml@main`);
      assert.deepEqual(workflow.jobs.image.needs, [language, 'security']);
    });

    it(`drops the deploy job for ${language} without deployDev`, () => {
      const { workflow } = render(language, false);
      assert.deepEqual(Object.keys(workflow.jobs), [language, 'security', 'image']);
    });
  }

  it('pins the python version only for python', () => {
    assert.deepEqual(render('python', true).workflow.jobs.python.with, { 'python-version': '3.13' });
    assert.equal(render('go', true).workflow.jobs.go.with, undefined);
    assert.equal(render('node', true).workflow.jobs.node.with, undefined);
  });

  it('ships the renovate config next to the workflow', () => {
    assert.ok(render('go', true).renovate.packageRules.length > 0);
  });
});
