const KEY = 'wyte_builds';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function writeAll(builds) {
  localStorage.setItem(KEY, JSON.stringify(builds));
}

export function saveBuild(record) {
  const builds = readAll();
  builds.unshift({
    id: record.runId,
    savedAt: Date.now(),
    favorite: false,
    notes: "",
    ...record
  });
  writeAll(builds.slice(0, 50)); // keep it bounded
}

export function getBuild(runId) {
  return readAll().find((b) => String(b.runId) === String(runId)) || null;
}

export function getAllBuilds() {
  return readAll();
}

export function updateBuild(runId, partial) {
  const builds = readAll();
  const idx = builds.findIndex((b) => String(b.runId) === String(runId));
  if (idx === -1) return null;
  builds[idx] = { ...builds[idx], ...partial };
  writeAll(builds);
  return builds[idx];
}

export function deleteBuild(runId) {
  writeAll(readAll().filter((b) => String(b.runId) !== String(runId)));
}

export function exportHistory() {
  return JSON.stringify(readAll(), null, 2);
}

export function importHistory(jsonText) {
  const incoming = JSON.parse(jsonText);
  if (!Array.isArray(incoming)) throw new Error("Import file must be a JSON array of builds.");
  const existing = readAll();
  const byId = new Map(existing.map((b) => [String(b.id ?? b.runId), b]));
  for (const b of incoming) byId.set(String(b.id ?? b.runId), b);
  writeAll([...byId.values()].slice(0, 200));
  return byId.size;
}
