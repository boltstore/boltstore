import { OAuthProviderConfig } from "./types";
import { googleProvider } from "./google";
import { githubProvider } from "./github";

type ProviderHandler = {
  name: string;
  scopes: string;
  getAuthUrl(redirectUri: string, config: OAuthProviderConfig): string;
  exchangeCode(code: string, redirectUri: string, config: OAuthProviderConfig): Promise<string>;
  fetchProfile(accessToken: string): Promise<{ id: string; email: string; name?: string }>;
};

export function getProviders(): Map<string, ProviderHandler> {
  const providers = new Map<string, ProviderHandler>();

  const googleConfig = {
    clientId: Bun.env.GOOGLE_CLIENT_ID,
    clientSecret: Bun.env.GOOGLE_CLIENT_SECRET,
  };

  if (googleConfig.clientId && googleConfig.clientSecret) {
    providers.set("google", googleProvider as ProviderHandler);
  }

  const githubConfig = {
    clientId: Bun.env.GITHUB_CLIENT_ID,
    clientSecret: Bun.env.GITHUB_CLIENT_SECRET,
  };

  if (githubConfig.clientId && githubConfig.clientSecret) {
    providers.set("github", githubProvider as ProviderHandler);
  }

  return providers;
}

export function getProviderEnvConfig(provider: string): OAuthProviderConfig {
  const lower = provider.toLowerCase();
  if (lower === "google") {
    if (!Bun.env.GOOGLE_CLIENT_ID || !Bun.env.GOOGLE_CLIENT_SECRET) {
      throw Object.assign(
        new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."),
        { status: 500 }
      );
    }
    return { clientId: Bun.env.GOOGLE_CLIENT_ID, clientSecret: Bun.env.GOOGLE_CLIENT_SECRET };
  }

  if (lower === "github") {
    if (!Bun.env.GITHUB_CLIENT_ID || !Bun.env.GITHUB_CLIENT_SECRET) {
      throw Object.assign(
        new Error("GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET."),
        { status: 500 }
      );
    }
    return { clientId: Bun.env.GITHUB_CLIENT_ID, clientSecret: Bun.env.GITHUB_CLIENT_SECRET };
  }

  throw Object.assign(
    new Error(`Unknown provider: ${provider}`),
    { status: 400 }
  );
}
