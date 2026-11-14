import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { renderTemplate } from '../scripts/render.mjs';
import { templateYaml, write } from './helpers.mjs';

describe('render', () => {
  let dir;
  let result;
  const values = { n: 'demo', empty: '' };
  const withNul = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a]);
  const withoutNul = Buffer.concat([
    Buffer.from('%PDF-1.4\n'),
    Buffer.from(Array.from({ length: 64 }, (_, index) => 0x80 + (index % 0x70))),
  ]);
  const lock = 'name ${{ values.n }} {# {%';

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
    const first = path.join(dir, 'first');
    write(path.join(first, 'a.txt'), 'first ${{ values.n }}');
    write(path.join(first, 'uv.lock'), lock);
    write(path.join(first, 'sub', 'uv.lock'), lock);
    write(path.join(first, '${{ values.n }}.lock'), lock);
    write(path.join(first, 'x.cfg'), lock);
    write(path.join(first, 'y.cfg'), lock);
    write(path.join(first, 'locks', 'inner.txt'), 'inner ${{ values.n }}');
    write(path.join(first, 'plain.txt'), 'plain ${{ values.n }}');
    write(path.join(first, 'run.sh'), 'echo ${{ values.n }}\n');
    fs.chmodSync(path.join(first, 'run.sh'), 0o755);
    write(path.join(first, '${{ values.empty }}', 'dropped.txt'), 'dropped');
    fs.writeFileSync(path.join(first, 'with-nul.bin'), withNul);
    fs.writeFileSync(path.join(first, 'without-nul.bin'), withoutNul);
    write(path.join(dir, 'second', 'a.txt'), 'second ${{ values.n }}');
    write(path.join(dir, 'second', 'b.txt'), 'b ${{ values.n }}');
    write(
      path.join(dir, 'template.yaml'),
      templateYaml([
        {
          id: 'one',
          url: './first',
          values,
          untouched: ['*.lock', '**/uv.lock', '{x,y}.cfg', 'lock*'],
        },
        { id: 'two', url: './second', values },
      ]),
    );
    result = renderTemplate(path.join(dir, 'template.yaml'), {}, path.join(dir, 'out'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const out = (...parts) => path.join(dir, 'out', 'app', ...parts);
  const text = (...parts) => fs.readFileSync(out(...parts), 'utf8');

  it('keeps a file written by an earlier step', () => {
    assert.equal(text('a.txt'), 'first demo');
    assert.equal(text('b.txt'), 'b demo');
  });

  it('reports files skipped because they already exist', () => {
    assert.deepEqual(result.steps, ['one', 'two']);
    assert.deepEqual(result.skipped, [path.join('app', 'a.txt')]);
  });

  it('copies files matched by a glob without templating but renders their names', () => {
    assert.equal(text('demo.lock'), lock);
    assert.equal(text('uv.lock'), lock);
    assert.equal(text('sub', 'uv.lock'), lock);
    assert.equal(text('x.cfg'), lock);
    assert.equal(text('y.cfg'), lock);
    assert.equal(text('plain.txt'), 'plain demo');
  });

  it('templates files inside a directory that only the pattern matches, as Backstage does', () => {
    assert.equal(text('locks', 'inner.txt'), 'inner demo');
  });

  it('copies binary files byte for byte, with or without a NUL byte', () => {
    assert.deepEqual(fs.readFileSync(out('with-nul.bin')), withNul);
    assert.deepEqual(fs.readFileSync(out('without-nul.bin')), withoutNul);
  });

  it('keeps the file mode', () => {
    assert.equal(fs.statSync(out('run.sh')).mode & 0o777, 0o755);
  });

  it('drops entries whose rendered path is empty', () => {
    assert.equal(fs.existsSync(out('dropped.txt')), false);
    assert.equal(fs.existsSync(out('${{ values.empty }}')), false);
  });
});
