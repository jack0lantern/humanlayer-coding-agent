import { mkdir, readdir, rename } from "fs/promises";
import { join, relative, resolve } from "path";

/** Matches UUID session folder names at the workspace root. */
const SESSION_SUBDIR_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Move loose files created at workspace root into the session subdirectory.
 *
 * `execute_command` runs with cwd = sessionDir but the shell can still write
 * outside it (e.g. `> ../index.html`). File tools use safePath and stay inside
 * the session; hoisting fixes downloads that zip `workspaceBase/sessionId`.
 */
export async function gatherLooseFilesIntoSessionDir(
  sessionDir: string,
  workspaceBase: string
): Promise<void> {
  const root = resolve(workspaceBase);
  const session = resolve(sessionDir);
  if (session === root) return;

  const relToRoot = relative(root, session);
  if (relToRoot.startsWith("..") || relToRoot === "") return;

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  await mkdir(session, { recursive: true });

  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SESSION_SUBDIR_NAME.test(ent.name)) continue;
      continue;
    }
    const from = join(root, ent.name);
    const to = join(session, ent.name);
    try {
      await rename(from, to);
    } catch {
      // Destination exists or busy — leave root copy in place
    }
  }
}
