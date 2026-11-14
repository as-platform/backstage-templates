import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { root } from '../scripts/render.mjs';

export const serviceTemplates = ['back-go', 'back-python', 'front-react'];

export const implementedTemplates = () =>
  fs
    .readdirSync(path.join(root, 'scaffolder'))
    .filter((name) => fs.statSync(path.join(root, 'scaffolder', name, 'template.yaml')).size > 0);

export const reservedNames = [
  'argocd', 'sealed-secrets', 'metallb', 'traefik', 'cert-manager', 'zot', 'keda', 'github-runner',
  'monitoring', 'backstage', 'postgres', 'kyverno', 'storage', 'default', 'podinfo', 'kube-system',
  'root', 'openbao', 'tailscale', 'apps', 'infra',
];

export const conventionalCommit = /^(feat|fix|refactor|perf|docs|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: [a-z].*[^.]$/;

export const bumpImageTag = String.raw`
  /^image:/ { in_image = 1; print; next }
  in_image && /^[^[:space:]#]/ { in_image = 0 }
  in_image && /^[[:space:]]+tag:/ { sub(/tag:.*/, "tag: \"" tag "\""); done = 1 }
  { print }
  END { if (!done) exit 3 }
`;

export const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rendered-'));

export const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

export const exists = (...parts) => fs.existsSync(path.join(...parts));

export const files = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));

export const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

export const loadTemplate = (name) => {
  const file = path.join(root, 'scaffolder', name, 'template.yaml');
  const text = fs.readFileSync(file, 'utf8');
  return { file, text, template: YAML.parse(text) };
};

export const templateYaml = (steps) =>
  YAML.stringify({
    spec: {
      parameters: [],
      steps: steps.map(({ id, url, values = {}, untouched }) => ({
        id,
        action: 'fetch:template',
        input: {
          url,
          targetPath: './app',
          values,
          ...(untouched ? { copyWithoutTemplating: untouched } : {}),
        },
      })),
    },
  });
