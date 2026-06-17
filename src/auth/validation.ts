export const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
export const MIN_PASSWORD_LENGTH = 8;

export function validateEmail(email: string): void {
  if (!email || typeof email !== "string") {
    throw Object.assign(new Error("Email is required."), { status: 400 });
  }
  if (email.length > 254) {
    throw Object.assign(new Error("Email exceeds maximum length."), { status: 400 });
  }
  if (email.toLowerCase() !== email || email.includes("\n") || email.includes("\r")) {
    throw Object.assign(new Error("Invalid email format."), { status: 400 });
  }
  if (!EMAIL_REGEX.test(email)) {
    throw Object.assign(new Error("Invalid email format."), { status: 400 });
  }
}

export function validatePassword(password: string): void {
  if (!password || typeof password !== "string") {
    throw Object.assign(new Error("Password is required."), { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw Object.assign(
      new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`),
      { status: 400 }
    );
  }
}