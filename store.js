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
  builds.unshift({ id: record.runId, savedAt: Date.now(), ...record });
  writeAll(builds.slice(0, 50)); // keep it bounded
}

export function getBuild(runId) {
  return readAll().find((b) => String(b.runId) === String(runId)) || null;
}

export function getAllBuilds() {
  return readAll();
}

export function deleteBuild(runId) {
  writeAll(readAll().filter((b) => String(b.runId) !== String(runId)));
}
