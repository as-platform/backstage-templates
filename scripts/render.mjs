import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

const renderTree = (from, to, values) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, environment.renderString(entry.name, { values }));
    if (entry.isDirectory()) {
      renderTree(source, target, values);
    } else {
      fs.writeFileSync(target, environment.renderString(fs.readFileSync(source, 'utf8'), { values }));
    }
  }
};

export const renderTemplate = (templateFile, parameters, outDir) => {
  const template = YAML.parse(fs.readFileSync(templateFile, 'utf8'));
  const context = { parameters: withDefaults(template, parameters) };
  const base = path.dirname(templateFile);
  const executed = [];
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const step of template.spec.steps) {
    if (step.action !== 'fetch:template') {
      continue;
    }
    if (step.if !== undefined && !resolve(step.if, context)) {
      continue;
    }
    const values = resolve(step.input.values, context);
    renderTree(path.resolve(base, step.input.url), path.join(outDir, step.input.targetPath), values);
    executed.push(step.id);
  }
  return executed;
};

export const renderFixture = (name) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', `${name}.json`), 'utf8'));
  const templateFile = path.join(root, 'scaffolder', fixture.template, 'template.yaml');
  const outDir = path.join(root, 'out', name);
  const steps = renderTemplate(templateFile, fixture.parameters, outDir);
  return { outDir, steps };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    console.error('usage: render.mjs <fixture>...');
    process.exit(2);
  }
  for (const name of names) {
    const { outDir, steps } = renderFixture(name);
    console.log(`${name}: ${steps.join(', ')} -> ${path.relative(root, outDir)}`);
  }
}
