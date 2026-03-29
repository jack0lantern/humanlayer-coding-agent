import { mkdir, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { gatherLooseFilesIntoSessionDir } from "../workspace-hoist.js";

describe("gatherLooseFilesIntoSessionDir", () => {
  let base: string;

  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
  });

  it("moves loose files from workspace root into the session folder", async () => {
    base = await mkdtemp(join(tmpdir(), "hoist-"));
    const sessionId = "3f8874bc-f410-4c11-8d3b-0e93befbd1b3";
    const sessionDir = join(base, sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(base, "index.html"), "<html>", "utf-8");
    await writeFile(join(base, "notes.txt"), "hi", "utf-8");

    await gatherLooseFilesIntoSessionDir(sessionDir, base);

    const rootNames = await readdir(base);
    expect(rootNames.sort()).toEqual([sessionId]);

    const inside = await readdir(sessionDir);
    expect(inside.sort()).toEqual(["index.html", "notes.txt"]);
  });

  it("does not move sibling session directories", async () => {
    base = await mkdtemp(join(tmpdir(), "hoist-"));
    const a = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const b = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
    await mkdir(join(base, a), { recursive: true });
    await mkdir(join(base, b), { recursive: true });
    await writeFile(join(base, "root.txt"), "x", "utf-8");

    await gatherLooseFilesIntoSessionDir(join(base, a), base);

    expect((await readdir(base)).sort()).toEqual([a, b]);
    expect(await readdir(join(base, a))).toEqual(["root.txt"]);
    expect(await readdir(join(base, b))).toEqual([]);
  });
});
