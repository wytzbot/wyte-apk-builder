import { listWorkflowRuns, getRun, getRunJobs, cancelRun, listRunArtifacts, downloadArtifactZip, runUrl } from './data.js';

// High-level stages shown to the user, each mapped to one or more real step names
// from wyte-builder.yml. Steps not listed here just roll into whichever stage
// is currently active — new/renamed workflow steps won't break the UI.
const STAGES = [
  { key: 'preparing', label: 'Preparing project', steps: ['Checkout repo', 'Validate inputs'] },
  { key: 'toolchain', label: 'Setting up build tools', steps: ['Setup Node', 'Setup Java', 'Setup Android SDK', 'Install Android SDK build components', 'Cache Gradle', 'Cache npm', 'Install Bubblewrap CLI'] },
  { key: 'manifest', label: 'Generating app manifest & icons', steps: ['Generate TWA manifest from the site'] },
  { key: 'signing', label: 'Preparing signing key', steps: ['Restore or generate signing key'] },
  { key: 'compiling', label: 'Compiling APK', steps: ['Build APK with Bubblewrap'] },
  { key: 'verifying', label: 'Verifying build', steps: ['Verify APK was produced'] },
  { key: 'uploading', label: 'Uploading artifact', steps: ['Upload APK artifact'] },
  { key: 'finishing', label: 'Finishing build', steps: ['Write build summary', 'Write failure summary'] }
];

const TYPICAL_BUILD_SECONDS = 180;
const POLL_INTERVAL_MS = 4000;
const RUN_DISCOVERY_TIMEOUT_MS = 90_000; // give the run up to 90s to appear in the list

function computeStageProgress(jobs) {
  const allSteps = jobs.flatMap((j) => j.steps || []);
  const byName = new Map(allSteps.map((s) => [s.name, s]));

  let currentIndex = 0;
  const stageStates = STAGES.map((stage, i) => {
    const matched = stage.steps.map((name) => byName.get(name)).filter(Boolean);
    let state = 'pending';
    if (matched.length) {
      if (matched.every((s) => s.status === 'completed' && s.conclusion === 'success')) state = 'done';
      else if (matched.some((s) => s.status === 'in_progress')) state = 'active';
      else if (matched.some((s) => s.conclusion === 'failure')) state = 'failed';
      else if (matched.every((s) => s.status === 'completed')) state = 'done'; // skipped counts as done for display
    }
    if (state === 'active' || state === 'failed') currentIndex = i;
    if (state === 'done') currentIndex = Math.max(currentIndex, i);
    return { ...stage, state };
  });

  return stageStates;
}

/**
 * Starts tracking the run created by the most recent dispatch that matches
 * `appName`/`packageName` and was created after `dispatchedAt`.
 *
 * `callbacks`: { onRunFound, onProgress, onDone, onFailed, onError }
 * Returns a controller: { cancel() } to stop polling / cancel the run.
 */
export function trackBuild(token, { appName, packageName, dispatchedAt }, callbacks) {
  let stopped = false;
  let runId = null;
  const startedAt = Date.now();

  async function findRun() {
    const deadline = Date.now() + RUN_DISCOVERY_TIMEOUT_MS;
    while (!stopped && Date.now() < deadline) {
      const runs = await listWorkflowRuns(token, 10);
      const match = runs.find((r) => {
        const created = new Date(r.created_at).getTime();
        return created >= dispatchedAt - 5000 && (r.display_title || '').includes(appName) && (r.display_title || '').includes(packageName);
      });
      if (match) return match;
      await sleep(3000);
    }
    return null;
  }

  async function pollRun() {
    while (!stopped) {
      let run, jobs;
      try {
        [run, jobs] = await Promise.all([getRun(token, runId), getRunJobs(token, runId)]);
      } catch (err) {
        callbacks.onError?.(err);
        return;
      }

      const stages = computeStageProgress(jobs);
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      callbacks.onProgress?.({
        stages,
        status: run.status,
        elapsedSeconds,
        estimatedRemainingSeconds: Math.max(0, TYPICAL_BUILD_SECONDS - elapsedSeconds),
        runUrl: runUrl(runId)
      });

      if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          callbacks.onDone?.({ runId, elapsedSeconds });
        } else {
          callbacks.onFailed?.({ runId, conclusion: run.conclusion, runUrl: runUrl(runId) });
        }
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  (async () => {
    try {
      const match = await findRun();
      if (stopped) return;
      if (!match) {
        callbacks.onError?.(new Error("Couldn't find the build on GitHub Actions after 90s. It may still start — check the Actions tab."));
        return;
      }
      runId = match.id;
      callbacks.onRunFound?.({ runId, runUrl: runUrl(runId) });
      await pollRun();
    } catch (err) {
      callbacks.onError?.(err);
    }
  })();

  return {
    cancel: async () => {
      stopped = true;
      if (runId) {
        try { await cancelRun(token, runId); } catch { /* best effort */ }
      }
    }
  };
}

/**
 * Fetches the run's artifact, downloads the zip, and extracts the .apk from
 * inside it (GitHub always wraps artifacts in a zip, even single files).
 * Requires JSZip (loaded globally via CDN in index.html).
 */
export async function fetchBuiltApk(token, runId) {
  const artifacts = await listRunArtifacts(token, runId);
  if (!artifacts.length) throw new Error('No artifact found for this run.');
  const artifact = artifacts[0];

  const outerZipBlob = await downloadArtifactZip(token, artifact.id);
  const zip = await JSZip.loadAsync(outerZipBlob);
  const apkEntry = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.apk'));
  if (!apkEntry) throw new Error('Artifact did not contain an .apk file.');

  const apkBlob = await apkEntry.async('blob');
  return {
    blob: apkBlob,
    fileName: apkEntry.name,
    sizeBytes: apkBlob.size,
    artifactName: artifact.name,
    createdAt: artifact.created_at
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
