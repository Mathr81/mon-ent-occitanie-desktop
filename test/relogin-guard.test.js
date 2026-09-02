const test = require("node:test");
const assert = require("node:assert/strict");
const { createReloginGuard } = require("../src/main/auth/relogin-guard");

test("autorise jusqu'a maxAttempts tentatives", () => {
  const guard = createReloginGuard({ maxAttempts: 3, delays: [2000, 4000, 8000] });
  for (let i = 0; i < 3; i++) {
    assert.equal(guard.shouldRetry(), true);
    guard.recordAttempt();
  }
  assert.equal(guard.shouldRetry(), false);
});

test("applique un backoff croissant", () => {
  const guard = createReloginGuard({ maxAttempts: 3, delays: [2000, 4000, 8000] });
  assert.equal(guard.nextDelay(), 2000);
  guard.recordAttempt();
  assert.equal(guard.nextDelay(), 4000);
  guard.recordAttempt();
  assert.equal(guard.nextDelay(), 8000);
});

test("reset relance le compteur apres un succes", () => {
  const guard = createReloginGuard({ maxAttempts: 3, delays: [2000, 4000, 8000] });
  guard.recordAttempt(); guard.recordAttempt(); guard.recordAttempt();
  assert.equal(guard.shouldRetry(), false);
  guard.reset();
  assert.equal(guard.shouldRetry(), true);
  assert.equal(guard.nextDelay(), 2000);
});

test("le dernier delai est reutilise au-dela du tableau", () => {
  const guard = createReloginGuard({ maxAttempts: 5, delays: [2000, 4000] });
  guard.recordAttempt(); guard.recordAttempt(); guard.recordAttempt();
  assert.equal(guard.nextDelay(), 4000);
});
