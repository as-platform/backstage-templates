import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
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
