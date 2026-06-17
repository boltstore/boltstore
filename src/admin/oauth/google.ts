import { OAuthProfile, OAuthProviderConfig } from "./types";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_SCOPES = "openid email profile";

async function googleExchangeCode(
  code: string,
  redirectUri: string,
  config: OAuthProviderConfig
): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw Object.assign(
      new Error(`Google token exchange failed: ${response.status} ${errorText}`),
      { status: 401 }
    );
  }

  const data = await response.json();
  return data.access_token as string;
}

async function googleFetchProfile(accessToken: string): Promise<OAuthProfile> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw Object.assign(
      new Error(`Google profile fetch failed: ${response.status}`),
      { status: 401 }
    );
  }

  const data = await response.json();
  return {
    id: data.sub,
    email: data.email,
    name: data.name,
  };
}

export const googleProvider = {
  name: "google",
  scopes: GOOGLE_SCOPES,
  getAuthUrl(redirectUri: string, config: OAuthProviderConfig): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
    });
    return `${GOOGLE_AUTH_URL}?${params}`;
  },
  exchangeCode: googleExchangeCode,
  fetchProfile: googleFetchProfile,
};
