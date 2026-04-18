import { readFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";

function tryReadText(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function resolveRepoGitDir(): string {
  // `process.cwd()` in Next dev is typically `<repo>/frontend`.
  // The git directory lives at `<repo>/.git`.
  return path.resolve(process.cwd(), "..", ".git");
}

function resolveShaFromRef(gitDir: string, ref: string): string | null {
  const refPath = path.join(gitDir, ref.replace(/^\//, ""));
  const direct = tryReadText(refPath)?.trim();
  if (direct) return direct;

  // Fallback: packed-refs (common in some setups).
  const packed = tryReadText(path.join(gitDir, "packed-refs"));
  if (!packed) return null;

  const lines = packed.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const [sha, packedRef] = line.split(" ");
    if (packedRef === ref) return sha;
  }

  return null;
}

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ enabled: false }, { status: 404 });
  }

  const gitDir = resolveRepoGitDir();
  const head = tryReadText(path.join(gitDir, "HEAD"))?.trim();
  if (!head) {
    return NextResponse.json({ enabled: true, branch: null, sha: null, shortSha: null });
  }

  if (head.startsWith("ref:")) {
    const ref = head.replace(/^ref:\s*/, "").trim(); // e.g. refs/heads/main
    const sha = resolveShaFromRef(gitDir, ref);
    const branch = ref.split("/").slice(2).join("/") || ref;
    const shortSha = sha ? sha.slice(0, 7) : null;
    return NextResponse.json({ enabled: true, branch, sha, shortSha });
  }

  // Detached HEAD (HEAD contains a sha)
  const sha = head;
  return NextResponse.json({ enabled: true, branch: null, sha, shortSha: sha.slice(0, 7) });
}

