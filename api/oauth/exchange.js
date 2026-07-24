export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { code, redirect_uri: redirectUri } = req.body || {};

  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "missing_code" });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Missing GitHub OAuth credentials");
    return res.status(500).json({ error: "server_misconfigured" });
  }

  try {
    const ghResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      })
    });

    if (!ghResponse.ok) {
      console.error("GitHub OAuth exchange failed:", ghResponse.status);
      return res.status(502).json({ error: "github_exchange_failed" });
    }

    const data = await ghResponse.json();

    if (data.error) {
      return res.status(400).json({
        error: data.error,
        error_description: data.error_description || "Authentication failed"
      });
    }

    if (!data.access_token) {
      return res.status(502).json({ error: "no_access_token_returned" });
    }

    return res.status(200).json({
      access_token: data.access_token,
      scope: data.scope,
      token_type: data.token_type || "bearer"
    });
  } catch (err) {
    console.error("OAuth exchange error:", err);
    return res.status(500).json({ error: "internal_error", message: err.message });
  }
      }
