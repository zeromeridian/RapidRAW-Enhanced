/**
 * Named presets kept in the app settings (tone curves, the Orbit Blend Pad, Zone Color
 * Grading). Free of runtime imports, so any preset module can use it.
 */

/** What `NamedPresetBar` needs of a preset. */
export interface NamedPreset {
  id: string;
  name: string;
}

export const normalizePresetName = (name: string) => name.trim().toLowerCase();

/**
 * Ids and names for presets cleaned from untrusted data (settings or a file), unique against
 * `existing` and each other: a candidate keeps its id unless it is taken, and a clashing name
 * gets " 2", " 3"…
 */
export const presetIdentities = (existing: Array<NamedPreset>) => {
  const ids = new Set(existing.map((preset) => preset.id));
  const names = new Set(existing.map((preset) => normalizePresetName(preset.name)));
  return (candidateId: unknown, candidateName: string): NamedPreset => {
    const baseName = candidateName.trim();
    let name = baseName;
    for (let suffix = 2; names.has(normalizePresetName(name)); suffix += 1) name = `${baseName} ${suffix}`;
    const id =
      typeof candidateId === 'string' && candidateId && !ids.has(candidateId) ? candidateId : crypto.randomUUID();
    ids.add(id);
    names.add(normalizePresetName(name));
    return { id, name };
  };
};
