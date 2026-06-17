import { OAuthProfile, OAuthProviderConfig } from "./types";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
const GITHUB_SCOPES = "user:email";

async function githubExchangeCode(
  code: string,
  redirectUri: string,
  config: OAuthProviderConfig
): Promise<string> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw Object.assign(
      new Error(`GitHub token exchange failed: ${response.status} ${errorText}`),
      { status: 401 }
    );
  }

  const data = await response.json();
  return data.access_token as string;
}

async function githubFetchProfile(accessToken: string): Promise<OAuthProfile> {
  const userResponse = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "Boltstore",
    },
  });

  if (!userResponse.ok) {
    throw Object.assign(
      new Error(`GitHub profile fetch failed: ${userResponse.status}`),
      { status: 401 }
    );
  }

  const userData = await userResponse.json();

  let email = userData.email as string | null;
  if (!email) {
    const emailsResponse = await fetch(GITHUB_EMAILS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Boltstore",
      },
    });

    if (emailsResponse.ok) {
      const emails = await emailsResponse.json() as { email: string; primary: boolean; verified: boolean }[];
      const primary = emails.find((e) => e.primary && e.verified);
      if (primary) email = primary.email;
    }
  }

  if (!email) {
    throw Object.assign(
      new Error("Could not find a verified email for this GitHub account."),
      { status: 400 }
    );
  }

  return {
    id: String(userData.id),
    email,
    name: userData.name || userData.login,
  };
}

export const githubProvider = {
  name: "github",
  scopes: GITHUB_SCOPES,
  getAuthUrl(redirectUri: string, config: OAuthProviderConfig): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: GITHUB_SCOPES,
    });
    return `${GITHUB_AUTH_URL}?${params}`;
  },
  exchangeCode: githubExchangeCode,
  fetchProfile: githubFetchProfile,
};
