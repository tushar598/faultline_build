// Input and exposure rules for the route handlers (pure, so they are unit-tested without the server-only module).

/** The local-network routes read files from the developer's checkout. They answer in `next dev`, or in a production
 *  server only when FAULTLINE_LOCAL_API=1 (the Playwright smoke test sets it); a deployed site never serves them
 *  (security review SEC-10). */
export const localApiEnabled = () => process.env.NODE_ENV !== "production" || process.env.FAULTLINE_LOCAL_API === "1";
export const localApiDisabled = () => Response.json({ error: "Local-network routes are disabled on this server." }, { status: 404 });

/** Only plain ids (letters, digits, dot, dash, underscore): nothing can escape the directory it is joined to. */
export const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/;
