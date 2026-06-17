export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
}

export interface OAuthConfig {
  google?: OAuthProviderConfig;
  github?: OAuthProviderConfig;
}

export interface OAuthProfile {
  id: string;
  email: string;
  name?: string;
}
