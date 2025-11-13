export const parseYaml = (yaml: string): Record<string, any> => {
  const result: Record<string, any> = {};
  yaml.split('\n').forEach(line => {
    const [rawKey, ...rest] = line.split(':');
    if (!rawKey) {
      return;
    }
    const key = rawKey.trim();
    const value = rest.join(':').trim();
    if (value === '') {
      result[key] = null;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      try {
        result[key] = JSON.parse(value.replace(/'/g, '"'));
      } catch (error) {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  });
  return result;
};

export class Vault {}
export class TFile {}
export const stringifyYaml = (_data: unknown): string => '';
export const Notice = jest.fn();
