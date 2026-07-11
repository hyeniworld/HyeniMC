import { describe, it, expect } from 'vitest';
import { validateModPublish, validatePackPublish } from './validate';

describe('validateModPublish', () => {
  const base = {
    modId: 'hyenihelper', name: 'HyeniHelper', version: '1.0.5',
    category: 'required', changelog: 'x',
    files: [{ loader: 'neoforge', gameVersion: '1.21.1', file: {} as File,
      fileName: 'a.jar', minLoaderVersion: '21.1.200', maxLoaderVersion: '', dependencies: '{}' }],
  };
  it('passes a valid input', () => {
    expect(validateModPublish(base)).toEqual([]);
  });
  it('rejects bad version', () => {
    expect(validateModPublish({ ...base, version: '1.0' }).length).toBeGreaterThan(0);
  });
  it('rejects empty files', () => {
    expect(validateModPublish({ ...base, files: [] }).length).toBeGreaterThan(0);
  });
  it('rejects a file missing loader', () => {
    const bad = { ...base, files: [{ ...base.files[0], loader: '' }] };
    expect(validateModPublish(bad).length).toBeGreaterThan(0);
  });
  it('rejects invalid dependencies JSON', () => {
    const bad = { ...base, files: [{ ...base.files[0], dependencies: '{bad' }] };
    expect(validateModPublish(bad).length).toBeGreaterThan(0);
  });
  it('accepts empty minLoaderVersion (하한 없음)', () => {
    const noMin = { ...base, files: [{ ...base.files[0], minLoaderVersion: '' }] };
    expect(validateModPublish(noMin)).toEqual([]);
  });
  it('accepts prerelease mod version, rejects malformed suffix', () => {
    expect(validateModPublish({ ...base, version: '1.0.6-beta001' })).toEqual([]);
    expect(validateModPublish({ ...base, version: '1.0.6-beta1' }).length).toBeGreaterThan(0);
  });
});

describe('validatePackPublish', () => {
  it('rejects missing pack file or bad version', () => {
    expect(validatePackPublish({ pack: null, version: '1.0.0' }).length).toBeGreaterThan(0);
    expect(validatePackPublish({ pack: {} as File, version: 'x' }).length).toBeGreaterThan(0);
  });
  it('passes valid', () => {
    expect(validatePackPublish({ pack: {} as File, version: '1.0.0' })).toEqual([]);
  });
});
