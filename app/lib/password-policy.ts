/**
 * Password rules (SOW Module 15: minimum length and complexity, periodic
 * reset, lockout after repeated failures).
 */

export interface PasswordPolicy {
  minLength: number;
  maxAgeDays: number;
}

/** The problems with a proposed password, or an empty list. */
export function passwordProblems(password: string, policy: PasswordPolicy, email = ""): string[] {
  const problems: string[] = [];
  if (password.length < policy.minLength) {
    problems.push(`at least ${policy.minLength} characters`);
  }
  if (!/[a-z]/.test(password)) problems.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("a number");
  if (!/[^A-Za-z0-9]/.test(password)) problems.push("a symbol");

  const local = email.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && password.toLowerCase().includes(local)) {
    problems.push(`${NOT_PREFIX}${local}`);
  }
  return problems;
}

/** Marks a problem that is something the password must not contain. */
const NOT_PREFIX = "not:";

export function describePasswordProblems(problems: string[]) {
  const needs = problems.filter((p) => !p.startsWith(NOT_PREFIX));
  const banned = problems.filter((p) => p.startsWith(NOT_PREFIX)).map((p) => p.slice(NOT_PREFIX.length));
  const parts: string[] = [];
  if (needs.length) parts.push(`The password needs ${needs.join(", ")}.`);
  if (banned.length) {
    parts.push(`It must not contain “${banned.join("”, “")}”, which is part of the email address — choose something harder to guess.`);
  }
  return parts.join(" ");
}

/** Whether a password set at `changedAt` has outlived the policy. */
export function passwordExpired(changedAt: string | null, maxAgeDays: number, now = new Date()) {
  if (maxAgeDays <= 0 || !changedAt) return false;
  const ageMs = now.getTime() - new Date(changedAt).getTime();
  return ageMs > maxAgeDays * 86400000;
}

/** Whether failures inside the lockout window reach the limit. */
export function isLockedOut(
  recentFailures: { attempted_at: string; succeeded: boolean }[],
  maxFailures: number,
  lockoutMinutes: number,
  now = new Date(),
): boolean {
  const windowStart = now.getTime() - lockoutMinutes * 60000;
  let failures = 0;
  // Newest first: a success resets the count.
  for (const attempt of [...recentFailures].sort((a, b) => b.attempted_at.localeCompare(a.attempted_at))) {
    if (new Date(attempt.attempted_at).getTime() < windowStart) break;
    if (attempt.succeeded) break;
    failures += 1;
  }
  return failures >= maxFailures;
}
