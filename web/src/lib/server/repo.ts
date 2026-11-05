// Server-only file access for the LOCAL route handlers: the oracle's local config, terms and mock HCS log, and the
// saved USGS fixtures. These files hold only public data (addresses, hashes, USGS records), never keys. The repo path
// is web/.. unless FAULTLINE_REPO_DIR says otherwise.
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

// turbopackIgnore: these files are read at request time from the repo, never bundled or traced into the build.
export const REPO_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.FAULTLINE_REPO_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".."));
export const ORACLE_DIR = path.join(REPO_DIR, "oracle");

/** Reads a JSON file; null when it does not exist. */
export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function listDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

export { SAFE_ID, localApiDisabled, localApiEnabled } from "./localApi";
