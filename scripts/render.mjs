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

const escapeRegExp = (text) => text.replace(/[|\\{}()[\]^$+.]/g, '\\$&');

const globToRegExp = (glob) => {
  const source = glob
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((piece) => escapeRegExp(piece).replace(/\?/g, '[^/]'))
        .join('[^/]*'),
    )
    .join('.*');
  return new RegExp(`^${source}$`);
};

const untouchedMatcher = (globs) => {
  const patterns = globs.map(globToRegExp);
  return (relative) => {
    const segments = relative.split('/');
    return segments.some((_, index) => {
      const prefix = segments.slice(0, index + 1).join('/');
      return patterns.some((pattern) => pattern.test(prefix));
    });
  };
};

const isBinary = (buffer) => buffer.includes(0);

const renderContent = (buffer, relative, values, untouched) =>
  isBinary(buffer) || untouched(relative)
    ? buffer
    : environment.renderString(buffer.toString('utf8'), { values });

const renderTree = (from, to, values, state, relative = '') => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const sourceRelative = path.posix.join(relative, entry.name);
    const target = path.join(to, environment.renderString(entry.name, { values }));
    if (entry.isDirectory()) {
      renderTree(source, target, values, state, sourceRelative);
    } else if (fs.existsSync(target)) {
      state.skipped.push(path.relative(state.outDir, target));
    } else {
      fs.writeFileSync(target, renderContent(fs.readFileSync(source), sourceRelative, values, state.untouched));
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
      untouched: untouchedMatcher(step.input.copyWithoutTemplating ?? []),
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
