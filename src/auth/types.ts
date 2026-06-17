export interface AuthConfig {
  secret?: string;
  accessTokenExpiry?: number;
  refreshTokenExpiry?: number;
}

export interface User {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface UserRow extends User {
  oauth_only?: number;
  password_set?: number;
  password_hash?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId?: string;
  email?: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
  jti: string;
  type?: "access" | "refresh";
  aud?: string;
  iss?: string;
}
