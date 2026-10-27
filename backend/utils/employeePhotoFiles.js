export async function listEmployeePhotoFiles(bucket, employee) {
  const roots = ['face-baselines', 'avatars'];
  const id = employee.id;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Valid employee identity required for photo cleanup.');
  const owns = name => typeof name === 'string' && (name === `${id}.jpg` || (name.startsWith(`${id}-`) && /\.(jpg|jpeg|png|webp)$/.test(name)));
  const folders = new Set();
  for (const root of roots) {
    for (const company of [employee.company_id, id, 'CP-MAIN']) {
      if (company && !String(company).split('/').some(part => part === '..' || part === '.')) folders.add(`${root}/${company}`);
    }
  }
  for (let path of [employee.biometric_baseline_path, employee.avatar_url]) {
    if (typeof path !== 'string') continue;
    if (/^https?:\/\//.test(path)) {
      try { path = decodeURIComponent(new URL(path).pathname.split('/storage/v1/object/public/public-bucket/')[1] || ''); }
      catch { continue; }
    }
    const parts = path.split('/');
    if (roots.includes(parts[0]) && !parts.some(part => part === '..' || part === '.') && owns(parts.at(-1))) folders.add(parts.slice(0, -1).join('/'));
  }
  const paths = new Set();
  // Collect before removing anything, otherwise offset pagination can skip remaining versions.
  for (const folder of folders) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(folder, { search: id, limit: 1000, offset });
      if (error) throw error;
      for (const file of data || []) if (owns(file.name) && !file.name.includes('/')) paths.add(`${folder}/${file.name}`);
      if (!data || data.length < 1000) break;
    }
  }
  return [...paths];
}
