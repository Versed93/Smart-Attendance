export interface PasswordCheckResult {
  valid: boolean;
  checks: {
    minLength: boolean;
    uppercase: boolean;
    lowercase: boolean;
    number: boolean;
    symbol: boolean;
  };
  errorMessage: string | null;
}

export function validateSignupPassword(password: string): PasswordCheckResult {
  const value = typeof password === 'string' ? password : '';
  const checks = {
    minLength: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
    number: /[0-9]/.test(value),
    symbol: /[^A-Za-z0-9\s]/.test(value),
  };

  const missing: string[] = [];
  if (!checks.minLength) missing.push('at least 8 characters');
  if (!checks.uppercase) missing.push('an uppercase letter (A-Z)');
  if (!checks.lowercase) missing.push('a lowercase letter (a-z)');
  if (!checks.number) missing.push('a number (0-9)');
  if (!checks.symbol) missing.push('a symbol/special character (e.g. !@#$%)');

  return {
    valid: missing.length === 0,
    checks,
    errorMessage:
      missing.length > 0
        ? `Password must include ${missing.join(', ')}.`
        : null,
  };
}
