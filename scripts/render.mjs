import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import globby from 'globby';
import { isBinaryFileSync } from 'isbinaryfile';
import nunjucks from 'nunjucks';
import YAML from 'yaml';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const environment = new nunjucks.Environment(null, {
  autoescape: false,
  tags: { variableStart: '${{', variableEnd: '}}' },
});

const wholeExpression = /^\$\{\{\s*([\w.]+)\s*\}\}$/;

const lookup = (context, expression) =>
  expression.split('.').reduce((value, key) => (value == null ? undefined : value[key]), context);

export const resolve = (input, context) => {
  if (typeof input === 'string') {
    const match = input.match(wholeExpression);
    return match ? lookup(context, match[1]) : environment.renderString(input, context);
  }
  if (Array.isArray(input)) {
    return input.map((item) => resolve(item, context));
  }
  if (input && typeof input === 'object') {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, resolve(value, context)]));
  }
  return input;
};

const withDefaults = (template, parameters) => {
  const defaults = {};
  for (const page of template.spec.parameters) {
    for (const [name, schema] of Object.entries(page.properties ?? {})) {
      if (schema.default !== undefined) {
        defaults[name] = schema.default;
      }
    }
  }
  return { ...defaults, ...parameters };
};

const listing = { dot: true, onlyFiles: false, markDirectories: true, followSymbolicLinks: false };

const containsSkippedContent = (rendered) =>
  rendered === '' || rendered.startsWith('/') || rendered.includes('//');

const copyEntry = (source, target, untouched, values) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stats = fs.lstatSync(source);
  if (stats.isSymbolicLink() || isBinaryFileSync(source)) {
    fs.cpSync(source, target);
    return;
  }
  const content = fs.readFileSync(source, 'utf8');
  fs.writeFileSync(target, untouched ? content : environment.renderString(content, { values }), {
    mode: stats.mode,
  });
};

const renderTree = (from, to, values, state) => {
  fs.mkdirSync(to, { recursive: true });
  const untouched = new Set(globby.sync(state.untouchedPatterns, { cwd: from, ...listing }));
  for (const location of globby.sync('**/*', { cwd: from, ...listing })) {
    const rendered = environment.renderString(location, { values });
    if (containsSkippedContent(rendered)) {
      continue;
    }
    const target = path.join(to, rendered);
    const isDirectory = location.endsWith('/');
    if (fs.existsSync(target)) {
      if (!isDirectory) {
        state.skipped.push(path.relative(state.outDir, target));
      }
    } else if (isDirectory) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      copyEntry(path.join(from, location), target, untouched.has(location), values);
    }
  }
};

export const renderTemplate = (templateFile, parameters, outDir) => {
  const template = YAML.parse(fs.readFileSync(templateFile, 'utf8'));
  const context = { parameters: withDefaults(template, parameters) };
  const base = path.dirname(templateFile);
  const steps = [];
  const skipped = [];
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const step of template.spec.steps) {
    if (step.action !== 'fetch:template') {
      continue;
    }
    if (step.if !== undefined && !resolve(step.if, context)) {
      continue;
    }
    const values = resolve(step.input.values, context);
    const state = {
      outDir,
      skipped,
      untouchedPatterns: step.input.copyWithoutTemplating ?? [],
    };
    renderTree(path.resolve(base, step.input.url), path.join(outDir, step.input.targetPath), values, state);
    steps.push(step.id);
  }
  return { steps, skipped };
};

export const renderFixture = (name) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', `${name}.json`), 'utf8'));
  const templateFile = path.join(root, 'scaffolder', fixture.template, 'template.yaml');
  const outDir = path.join(root, 'out', name);
  const { steps, skipped } = renderTemplate(templateFile, fixture.parameters, outDir);
  return { outDir, steps, skipped };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    console.error('usage: render.mjs <fixture>...');
    process.exit(2);
  }
  for (const name of names) {
    const { outDir, steps, skipped } = renderFixture(name);
    console.log(`${name}: ${steps.join(', ')} -> ${path.relative(root, outDir)}`);
    for (const file of skipped) {
      console.log(`  skipped existing: ${file}`);
    }
  }
}
