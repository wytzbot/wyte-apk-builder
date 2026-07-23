// data.js
export const CONFIG = {
  CLIENT_ID: "Ov23ligGzK8hLcmDEbf5", // Public ID
  REDIRECT_URI: window.location.origin,
  GITHUB_API: "https://api.github.com",
  REPO_OWNER: "wytzbot",
  REPO_NAME: "wyte-apk-builder"
}

export async function getGitHubUser(token) {
  const res = await fetch(`${CONFIG.GITHUB_API}/user`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
}

export async function triggerGitHubAction(url, appName, token) {
  const workflowUrl = `${CONFIG.GITHUB_API}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/actions/workflows/wyte-builder.yml/dispatches`;
  
  return fetch(workflowUrl, {
    method: "POST",
    headers: { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { app_url: url, app_name: appName }
    })
  });
}
