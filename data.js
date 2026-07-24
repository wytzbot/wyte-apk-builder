export const CONFIG = {
  CLIENT_ID: "Ov23ligGzK8hLcmDEbf5", // Public GitHub OAuth Client ID
  REDIRECT_URI: window.location.origin + window.location.pathname,
  GITHUB_API: "https://api.github.com",
  TEMPLATE_OWNER: "wytzbot",       // CHANGE THIS to your github username — the repo builds get forked from
  REPO_NAME: "wyte-apk-builder",   // CHANGE THIS to your repo name
  WORKFLOW_FILE: "wyte-builder.yml"
};

export async function getGitHubUser(token) {
  const res = await fetch(`${CONFIG.GITHUB_API}/user`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Bad token");
  return res.json();
}

/**
 * Exchanges a GitHub OAuth `code` for an access token by calling our
 * own serverless function (the only place that holds the client secret).
 */
export async function exchangeCodeForToken(code) {
  const res = await fetch("/api/oauth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: CONFIG.REDIRECT_URI })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `OAuth exchange failed (${res.status})`);
  }
  if (!data.access_token) {
    throw new Error("OAuth exchange succeeded but no access_token was returned.");
  }
  return data.access_token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
}

/**
 * Makes sure the logged-in user has their own fork of the template repo with
 * the build workflow enabled, so builds run on THEIR GitHub Actions minutes
 * instead of ours. Safe to call every time — no-ops if already set up.
 */
export async function ensureUserFork(token, username) {
  const repoUrl = `${CONFIG.GITHUB_API}/repos/${username}/${CONFIG.REPO_NAME}`;
  let res = await fetch(repoUrl, { headers: authHeaders(token) });

  if (res.status === 404) {
    const forkRes = await fetch(
      `${CONFIG.GITHUB_API}/repos/${CONFIG.TEMPLATE_OWNER}/${CONFIG.REPO_NAME}/forks`,
      { method: "POST", headers: authHeaders(token) }
    );
    if (!forkRes.ok) throw new Error(`Could not fork the build repo (${forkRes.status})`);

    // Forking is async on GitHub's side — poll until it actually exists.
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 2500));
      res = await fetch(repoUrl, { headers: authHeaders(token) });
      if (res.ok) break;
    }
    if (!res.ok) throw new Error("Timed out waiting for your fork to be created on GitHub.");
  } else if (!res.ok) {
    throw new Error(`Could not check for your fork (${res.status})`);
  }

  // Forks have Actions workflows disabled by default — enable this one explicitly.
  await fetch(
    `${CONFIG.GITHUB_API}/repos/${username}/${CONFIG.REPO_NAME}/actions/workflows/${CONFIG.WORKFLOW_FILE}/enable`,
    { method: "PUT", headers: authHeaders(token) }
  ).catch(() => {});

  return true;
}

export async function triggerGitHubAction(config, token, username) {
  const res = await fetch(
    `${CONFIG.GITHUB_API}/repos/${username}/${CONFIG.REPO_NAME}/actions/workflows/${CONFIG.WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          app_url: config.appUrl,
          app_name: config.appName,
          package_name: config.packageName,
          version_name: config.versionName,
          version_code: String(config.versionCode),
          orientation: config.orientation,
          theme_color: config.themeColor,
          background_color: config.backgroundColor,
          display_mode: config.displayMode,
          icon_url: config.iconUrl || "",
          start_url: config.startUrl,
          enable_notifications: String(config.enableNotifications),
          fallback_type: config.fallbackType,
          build_id: config.buildId
        }
      })
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Failed to start build (${res.status})`);
  }
  return true;
}

/** GitHub doesn't hand back a run ID from a dispatch call, so we tag each
 *  run's display title with our build_id (via `run-name:` in the workflow)
 *  and poll the runs list until we find the match. */
export async function findRunByBuildId(token, username, buildId, { maxAttempts = 8, delayMs = 2500 } = {}) {
  const url = `${CONFIG.GITHUB_API}/repos/${username}/${CONFIG.REPO_NAME}/actions/runs?event=workflow_dispatch&per_page=15`;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(url, { headers: authHeaders(token) });
    if (res.ok) {
      const data = await res.json();
      const match = (data.workflow_runs || []).find(r => (r.display_title || r.name || "").includes(buildId));
      if (match) return match;
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

export async function getRun(token, username, runId) {
  const res = await fetch(`${CONFIG.GITHUB_API}/repos/${username}/${CONFIG.REPO_NAME}/actions/runs/${runId}`, {
    headers: authHeaders(token)
  });
  if (!res.ok) throw new Error(`Failed to fetch run ${runId} (${res.status})`);
  return res.json();
}

export async function getRunJobs(token, username, runId) {
  const res = await fetch(`${CONFIG.GITHUB_API}/repos/${username}/${CONFIG.REPO_NAME}/actions/runs/${runId}/jobs`, {
    headers: authHeaders(token)
  });
  if (!res.ok) throw new Error(`Failed to fetch jobs for run ${runId} (${res.status})`);
  const data = await res.json();
  return data.jobs || [];
}

export async function cancelRun(token, username, runId) {
  const res = await fetch(`${CONFIG.GITHUB_API}/repos/${username}/${CONFIG.REPO_NAME}/actions/runs/${runId}/cancel`, {
    method: "POST",
    headers: authHeaders(token)
  });
  if (!res.ok && res.status !== 202) throw new Error(`Failed to cancel run ${runId} (${res.status})`);
}

export async function listRunArtifacts(token, username, runId) {
  const res = await fetch(`${CONFIG.GITHUB_API}/repos/${username}/${CONFIG.REPO_NAME}/actions/runs/${runId}/artifacts`, {
    headers: authHeaders(token)
  });
  if (!res.ok) throw new Error(`Failed to list artifacts for run ${runId} (${res.status})`);
  const data = await res.json();
  return data.artifacts || [];
}

/** GitHub always zips artifacts (even a single file), so the downloaded
 *  file will be a .zip containing the .apk/.aab. */
export async function downloadArtifactZip(token, username, artifactId) {
  const res = await fetch(
    `${CONFIG.GITHUB_API}/repos/${username}/${CONFIG.REPO_NAME}/actions/artifacts/${artifactId}/zip`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) throw new Error(`Failed to download artifact ${artifactId} (${res.status})`);
  return res.blob();
}

export function runUrl(username, runId) {
  return `https://github.com/${username}/${CONFIG.REPO_NAME}/actions/runs/${runId}`;
}
