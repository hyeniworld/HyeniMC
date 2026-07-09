export function buildModPublishForm(meta: unknown, files: Map<string, File>): FormData {
  const fd = new FormData();
  fd.set('meta', JSON.stringify(meta));
  for (const [field, file] of files) fd.set(field, file);
  return fd;
}

export function buildPackPublishForm(pack: File, sidecar: unknown): FormData {
  const fd = new FormData();
  fd.set('pack', pack);
  fd.set('latest', JSON.stringify(sidecar));
  return fd;
}
