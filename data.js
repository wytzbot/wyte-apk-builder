export const CONFIG = {
  CLIENT_ID: "Ov23ligGzK8hLcmDEbf5", // Your public OAuth Client ID
  REDIRECT_URI: window.location.origin,
  GITHUB_API: "https://api.github.com",
  REPO_OWNER: "wytzbot", // CHANGE THIS to your github username
  REPO_NAME: "wyte-apk-builder" // CHANGE THIS to your repo name
}

export async function getGitHubUser(token) {
  const res = await fetch(`${CONFIG.GITHUB_API}/user`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if(!res.ok) throw new Error("Bad token");
  return res.json();
}

export async function triggerGitHubAction(url, appName, token) {
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
      inputs: { app_url: url, app_name: appName }
    })
  });
}
