import type { ParsedQs } from 'qs';

export function queryParamToString(
  value: string | ParsedQs | (string | ParsedQs)[] | undefined
): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return '';
}
