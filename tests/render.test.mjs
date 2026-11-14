import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { renderTemplate } from '../scripts/render.mjs';

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const template = (steps) =>
  [
    'spec:',
    '  parameters: []',
    '  steps:',
    ...steps.flatMap((step) => [
      `    - id: ${step.id}`,
      '      action: fetch:template',
      '      input:',
      `        url: ${step.url}`,
      '        targetPath: ./app',
      '        values:',
      '          n: demo',
      ...(step.untouched ? ['        copyWithoutTemplating:', ...step.untouched.map((glob) => `          - '${glob}'`)] : []),
    ]),
  ].join('\n');

describe('render', () => {
  let dir;
  let result;
  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a]);

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
    write(path.join(dir, 'first', 'a.txt'), 'first ${{ values.n }}');
    write(path.join(dir, 'first', 'locks', 'x.lock'), 'name ${{ values.n }} {# {%');
    write(path.join(dir, 'first', '${{ values.n }}.lock'), 'name ${{ values.n }} {# {%');
    write(path.join(dir, 'first', 'plain.txt'), 'plain ${{ values.n }}');
    fs.writeFileSync(path.join(dir, 'first', 'image.bin'), binary);
    write(path.join(dir, 'second', 'a.txt'), 'second ${{ values.n }}');
    write(path.join(dir, 'second', 'b.txt'), 'b ${{ values.n }}');
    write(
      path.join(dir, 'template.yaml'),
      template([
        { id: 'one', url: './first', untouched: ['*.lock', 'locks/**'] },
        { id: 'two', url: './second' },
      ]),
    );
    result = renderTemplate(path.join(dir, 'template.yaml'), {}, path.join(dir, 'out'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const out = (...parts) => path.join(dir, 'out', 'app', ...parts);

  it('keeps a file written by an earlier step', () => {
    assert.equal(fs.readFileSync(out('a.txt'), 'utf8'), 'first demo');
    assert.equal(fs.readFileSync(out('b.txt'), 'utf8'), 'b demo');
  });

  it('reports files skipped because they already exist', () => {
    assert.deepEqual(result.steps, ['one', 'two']);
    assert.deepEqual(result.skipped, [path.join('app', 'a.txt')]);
  });

  it('copies matched files without templating but renders their names', () => {
    assert.equal(fs.readFileSync(out('demo.lock'), 'utf8'), 'name ${{ values.n }} {# {%');
    assert.equal(fs.readFileSync(out('locks', 'x.lock'), 'utf8'), 'name ${{ values.n }} {# {%');
    assert.equal(fs.readFileSync(out('plain.txt'), 'utf8'), 'plain demo');
  });

  it('copies binary files byte for byte', () => {
    assert.deepEqual(fs.readFileSync(out('image.bin')), binary);
  });
});
