import { describe, it, expect } from 'vitest';
import { buildModPublishForm, buildPackPublishForm } from './formdata';

describe('buildModPublishForm', () => {
  it('produces meta JSON + file parts named by fileField', () => {
    const files = new Map<string, File>([['jar0', new File(['x'], 'a.jar')]]);
    const meta = { modId: 'm', name: 'M', version: '1.0.0', category: 'required',
      changelog: 'c', files: [{ loader: 'neoforge', gameVersion: '1.21.1',
        fileField: 'jar0', fileName: 'a.jar', minLoaderVersion: '1', maxLoaderVersion: null, dependencies: {} }] };
    const fd = buildModPublishForm(meta, files);
    expect(JSON.parse(fd.get('meta') as string).modId).toBe('m');
    expect(fd.get('jar0')).toBeInstanceOf(File);
  });
});

describe('buildPackPublishForm', () => {
  it('produces pack + latest fields', () => {
    const fd = buildPackPublishForm(new File(['x'], 'p.hyenipack'), { hyenipackId: 'p', version: '1.0.0', sha256: 'abc' });
    expect(fd.get('pack')).toBeInstanceOf(File);
    expect(JSON.parse(fd.get('latest') as string).hyenipackId).toBe('p');
  });
});
