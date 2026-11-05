// Expected-failure tests for OPEN findings (first used in 9d08aa2, test/security.contracts.test.ts). `secure` states the
// CORRECT behaviour. While the finding is open its assertion fails with an AssertionError and the wrapper passes; the
// moment the assertion holds the wrapper turns red, so the fix must rename it to a normal `it`. Any other error (broken
// setup) fails the test.
import { AssertionError } from "chai";

export function openFinding(id: string, title: string, secure: () => Promise<void>) {
  it(`[${id} OPEN, expected to fail until fixed] ${title}`, async () => {
    try {
      await secure();
    } catch (e) {
      if (e instanceof AssertionError) {
        if (process.env.SECURITY_VERBOSE) console.log(`      ${id} reproduces: ${e.message}`);
        return; // the finding reproduces
      }
      throw e;
    }
    throw new Error(`${id}: the secure behaviour now holds. Mark the finding fixed in docs/SECURITY-TEST-REPORT.md and turn this into a normal test.`);
  });
}

/** Runs `tx` and turns any revert into an AssertionError, so `openFinding` counts it as the finding reproducing. */
export async function mustNotRevert(what: string, tx: () => Promise<unknown>) {
  try {
    await tx();
  } catch (e) {
    throw new AssertionError(`${what} must not revert: ${(e as Error).message}`);
  }
}
