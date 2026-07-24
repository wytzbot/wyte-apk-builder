export const CONFIG = {
  CLIENT_ID: "Ov23ligGzK8hLcmDEbf5", // Your public OAuth Client ID
  OAUTH_WORKER_URL: window.location.origin + "/api/oauth/exchange", // Vercel API route (same origin)
  REDIRECT_URI: window.location.origin + window.location.pathname,
  GITHUB_API: "https://api.github.com",
  REPO_OWNER: "wytzbot", // CHANGE THIS to your github username
  REPO_NAME: "wyte-apk-builder" // CHANGE THIS to your repo name
}

export async function getGitHubUser(token) {
  const res = await fetch(`${CONFIG.GITHUB_API}/user`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Bad token");
  return res.json();
}

/**
 * Exchanges a GitHub OAuth `code` for an access token by calling our
 * Cloudflare Worker (the only place that holds the client secret).
 * Throws with a descriptive message on failure.
 */
export async function exchangeCodeForToken(code) {
  const res = await fetch(`${CONFIG.OAUTH_WORKER_URL}/api/oauth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: CONFIG.REDIRECT_URI })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.error) {
    throw new Error(data.description || data.error || `OAuth exchange failed (${res.status})`);
  }
  if (!data.access_token) {
    throw new Error("OAuth exchange succeeded but no access_token was returned.");
  }
  return data.access_token;
}

/**
 * Triggers the wyte-builder.yml workflow with the FULL set of inputs it
 * now expects. `config` fields map 1:1 to the workflow_dispatch inputs;
 * see buildDefaultConfig() in app.js for defaults.
 */
function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
}

/** Lists recent runs of the workflow, most recent first. */
export async function listWorkflowRuns(token, perPage = 10) {
  const res = await fetch(
    `${CONFIG.GITHUB_API}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/actions/workflows/wyte-builder.yml/runs?event=workflow_dispatch&per_page=${perPage}`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) throw new Error(`Failed to list workflow runs (${res.status})`);
  const data = await res.json();
  return data.workflow_runs || [];
}

/** Gets a single run's status/conclusion. */
export async function getRun(token, runId) {
  const res = await fetch(`${CONFIG.GITHUB_API}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/actions/runs/${runId}`, {
    headers: authHeaders(token)
  });
  if (!res.ok) throw new Error(`Failed to fetch run ${runId} (${res.status})`);
  return res.json();
}

/** Gets the jobs (and their steps) for a run — this is what drives the stage checklist. */
export async function getRunJobs(token, runId) {
  const res = await fetch(`${CONFIG.GITHUB_API}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/actions/runs/${runId}/jobs`, {
    headers: authHeaders(token)
  });
  if (!res.ok) throw new Error(`Failed to fetch jobs for run ${runId} (${res.status})`);
  const data = await res.json();
  return data.jobs || [];
}

/** Cancels an in-progress run. */
export async function cancelRun(token, runId) {
  const res = await fetch(`${CONFIG.GITHUB_API}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/actions/runs/${runId}/cancel`, {
    method: "POST",
    headers: authHeaders(token)
  });
  if (!res.ok && res.status !== 202) throw new Error(`Failed to cancel run ${runId} (${res.status})`);
}

/** Lists artifacts produced by a run. */
export async function listRunArtifacts(token, runId) {
  const res = await fetch(`${CONFIG.GITHUB_API}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/actions/runs/${runId}/artifacts`, {
    headers: authHeaders(token)
  });
  if (!res.ok) throw new Error(`Failed to list artifacts for run ${runId} (${res.status})`);
  const data = await res.json();
  return data.artifacts || [];
}

/** Downloads an artifact's zip as a Blob. GitHub artifacts are always zipped, even a single file. */
export async function downloadArtifactZip(token, artifactId) {
  const res = await fetch(
    `${CONFIG.GITHUB_API}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/actions/artifacts/${artifactId}/zip`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) throw new Error(`Failed to download artifact ${artifactId} (${res.status})`);
  return res.blob();
}

export function runUrl(runId) {
  return `https://github.com/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/actions/runs/${runId}`;
}

export async function triggerGitHubAction(config, token) {
  const workflowUrl = `${CONFIG.GITHUB_API}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/actions/workflows/wyte-builder.yml/dispatches`;

  return fetch(workflowUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json"
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        app_url: config.appUrl,
        app_name: config.appName,
        package_name: config.packageName,
        version_name: config.versionName,
        version_code: config.versionCode,
        orientation: config.orientation,
        theme_color: config.themeColor,
        background_color: config.backgroundColor,
        display_mode: config.displayMode,
        icon_url: config.iconUrl || "",
        start_url: config.startUrl,
        enable_notifications: String(config.enableNotifications),
        fallback_type: config.fallbackType
      }
    })
  });
}
