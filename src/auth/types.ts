export interface AuthConfig {
  secret?: string;
  accessTokenExpiry?: number;
  refreshTokenExpiry?: number;
}

export interface User {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: string;
  updated_at: string;
}

export interface UserRow extends User {
  oauth_only?: number;
  password_hash?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId?: string;
  email?: string;
  role?: "user" | "admin";
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: "user" | "admin";
  iat: number;
  exp: number;
  jti: string;
  type?: "access" | "refresh";
  aud?: string;
  iss?: string;
}