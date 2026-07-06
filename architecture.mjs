// getAdvantage — ARCHITECTURE / ACCRETION scanner (`getadvantage architecture`).
//
// The deterministic signal an AI coding agent is missing: WHERE the codebase is
// rotting through ACCRETION — building-over instead of collapsing. Agents add
// to files and duplicate special-cases because nothing measures the growing
// mess for them; a human familiar with a codebase feels it. This command
// externalizes that instinct as an honest, read-only measurement:
//
//   1. OVERSIZED FILES  — line count per source file, in three tiers
//                         (notice >600 · warn >1000 · flag >1800). Big files
//                         are where agents accrete and parallel lanes collide.
//   2. CHURN HOTSPOTS   — how often each file changed in the last 100 commits
//                         (`git log --name-only`). BIG × HOT = top candidate.
//   3. DUPLICATION      — near-duplicate blocks: normalized lines (trimmed,
//                         comments/imports/blank dropped), sliding windows of
//                         15 lines hashed; a block counts when the same window
//                         appears >= 3 times. Exact/near-exact repetition only
//                         — NOT semantic clone detection.
//   4. COMPLEXITY       — JS/TS-only, explicitly APPROXIMATE: brace-nesting
//                         depth, functions with many parameters, branch
//                         density. A hint, not a metric.
//
// The VERDICT ranks the top collapse candidates (size × churn × duplication),
// each with its concrete signals and a one-line clean-move framing.
//
// HONESTY (hard rules of this module):
//   • We SURFACE accretion — we never refactor, and we NEVER claim the code is
//     "clean" / "good" / "well-architected". Finding nothing means the
//     heuristics found nothing, no more.
//   • ADVISORY ONLY — accretion does not block a ship. Exit code is 0 unless
//     the scan itself crashes. `check`'s GO/NO-GO is never affected.
//
// Read-only. Node built-ins only. Honors .gitignore via `git ls-files`.

import path from "node:path";
import { createHash } from "node:crypto";
import { c, section, gitSafe, readText } from "./util.mjs";

// --- thresholds (exported for the tests) -------------------------------------
export const SIZE_NOTICE = 600; // lines — worth noticing
export const SIZE_WARN = 1000; // lines — agents accrete here
export const SIZE_FLAG = 1800; // lines — a collapse candidate on size alone
export const CHURN_COMMITS = 100; // how many recent commits the churn window reads
export const DUP_WINDOW = 15; // normalized lines per duplication window
export const DUP_MIN_OCCURRENCES = 3; // a window must repeat this often to count
const HOT_CHURN = 10; // "hot" — changed in >=10 of the last CHURN_COMMITS
const DEFAULT_TOP = 10;

// --- what counts as a source file --------------------------------------------
const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rb", ".java", ".rs", ".php", ".cs",
  ".kt", ".kts", ".swift", ".vue", ".svelte",
  ".c", ".cc", ".cpp", ".h", ".hpp",
]);
// Vendored / generated dirs we never scan (belt over .gitignore's suspenders —
// some repos commit these).
const SKIP_DIR = new Set([
  "node_modules", ".next", ".nuxt", ".git", ".vercel", ".turbo", ".yarn",
  "dist", "build", "out", "coverage", "vendor", "vendors", "__generated__",
  ".venv", "venv", "target",
]);
// Generated / minified file names.
const SKIP_FILE_RE = /(\.min\.(js|css)$|\.d\.ts$|\.(generated|gen)\.|_pb2?\.py$|\.pb\.go$)/;

/** Source files to scan: tracked + untracked-but-not-ignored (same contract as
 *  the secret scan — `--others --exclude-standard` honors .gitignore). Returns
 *  repo-relative forward-slash paths, matching `git log --name-only` output. */
function sourceFiles(cwd) {
  const set = new Set();
  for (const f of gitSafe(["ls-files"], { cwd }).split("\n")) if (f) set.add(f);
  for (const f of gitSafe(["ls-files", "--others", "--exclude-standard"], { cwd }).split("\n")) if (f) set.add(f);
  const out = [];
  for (const rel of set) {
    const ext = path.extname(rel).toLowerCase();
    if (!SOURCE_EXT.has(ext)) continue;
    if (SKIP_FILE_RE.test(rel)) continue;
    if (rel.split("/").some((seg) => SKIP_DIR.has(seg))) continue;
    out.push(rel);
  }
  return out.sort();
}

/** Physical line count (wc -l-ish: a trailing newline doesn't add a line). */
function countLines(text) {
  const parts = text.split("\n");
  return parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
}

/** Minified/generated content heuristic: any enormous line means "not
 *  human-maintained" — skip it (it can't accrete the way source does). */
function looksGenerated(text) {
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      if (i - start > 5000) return true;
      start = i + 1;
    }
  }
  return text.length - start > 5000;
}

// --- churn --------------------------------------------------------------------

/** How often each file changed in the last CHURN_COMMITS commits.
 *  `git log --name-only --pretty=format:%H` → count path occurrences.
 *  Returns { counts: Map<relPath, n>, commitsExamined }. Best-effort: an empty
 *  history (fresh repo) yields zero counts, never an error. */
function churnCounts(cwd) {
  const raw = gitSafe(
    ["-c", "core.quotepath=false", "log", "--name-only", "--pretty=format:%H", "-n", String(CHURN_COMMITS)],
    { cwd },
  );
  const counts = new Map();
  let commitsExamined = 0;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^[0-9a-f]{40}$/.test(t)) {
      commitsExamined++;
      continue;
    }
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return { counts, commitsExamined };
}

// --- duplication ---------------------------------------------------------------

/** Normalize a file into comparable lines: trim, collapse whitespace, drop
 *  blank / comment-only / import / pure-punctuation lines. Each entry keeps its
 *  1-based ORIGINAL line number so reports point at real code. */
function normalizeLines(text) {
  const out = [];
  const lines = text.split("\n");
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    let t = lines[i].trim();
    if (inBlockComment) {
      const end = t.indexOf("*/");
      if (end === -1) continue;
      t = t.slice(end + 2).trim();
      inBlockComment = false;
    }
    if (!t) continue;
    if (t.startsWith("//") || t.startsWith("#") || t.startsWith("*")) continue;
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlockComment = true;
      continue; // comment-opening line (any trailing code on it is dropped — approximate)
    }
    const norm = t.replace(/\s+/g, " ");
    if (norm.length < 4) continue; // `}`, `);`, …
    if (/^[{}()[\];,.:]+$/.test(norm)) continue;
    // Import/boilerplate lines repeat across files by design — not accretion.
    if (/^(import\b|export \{[^}]*\} from\b|export \* from\b|from \S+ import\b|using \S|package \S|require\s*\()/.test(norm)) continue;
    out.push({ norm, orig: i + 1 });
  }
  return out;
}

function windowHash(norms, start) {
  const h = createHash("sha1");
  for (let k = 0; k < DUP_WINDOW; k++) h.update(norms[start + k].norm).update("\n");
  return h.digest("base64").slice(0, 16);
}

/**
 * Find repeated blocks across all files.
 * Every DUP_WINDOW-line window of every file is hashed; a hash occurring
 * >= DUP_MIN_OCCURRENCES times is "hot". Hot windows are merged per file into
 * maximal blocks (overlapping windows of one long duplicate collapse to one
 * block). Returns per-file: block ranges (original line numbers) + which other
 * files share a hot window with it.
 */
function findDuplication(fileEntries) {
  const occurrences = new Map(); // hash → [{ f: fileIdx, s: normStart }]
  fileEntries.forEach((fe, f) => {
    const norms = fe.norms;
    for (let s = 0; s + DUP_WINDOW <= norms.length; s++) {
      const h = windowHash(norms, s);
      let arr = occurrences.get(h);
      if (!arr) occurrences.set(h, (arr = []));
      if (arr.length < 64) arr.push({ f, s }); // cap: pathological repetition can't blow memory
    }
  });

  const covered = fileEntries.map(() => new Set()); // normalized-line indices in a hot window
  const sharedWith = fileEntries.map(() => new Set()); // fileIdx → other fileIdx sharing a block
  for (const arr of occurrences.values()) {
    if (arr.length < DUP_MIN_OCCURRENCES) continue;
    const filesInGroup = new Set(arr.map((o) => o.f));
    for (const { f, s } of arr) {
      for (let k = 0; k < DUP_WINDOW; k++) covered[f].add(s + k);
      for (const g of filesInGroup) if (g !== f) sharedWith[f].add(g);
    }
  }

  // Merge contiguous covered indices into blocks, reported as original lines.
  return fileEntries.map((fe, f) => {
    const idx = [...covered[f]].sort((a, b) => a - b);
    const blocks = [];
    let start = -1;
    let prev = -2;
    for (const i of idx) {
      if (i !== prev + 1) {
        if (start >= 0) blocks.push({ from: fe.norms[start].orig, to: fe.norms[prev].orig });
        start = i;
      }
      prev = i;
    }
    if (start >= 0) blocks.push({ from: fe.norms[start].orig, to: fe.norms[prev].orig });
    return { blocks, sharedWith: [...sharedWith[f]] };
  });
}

// --- complexity (JS/TS only, approximate by design) ---------------------------

const JS_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/** Strip comments and string/template contents so braces inside them don't
 *  count as nesting. Character-walk; regex literals are NOT handled (a stated
 *  approximation). */
function stripCommentsAndStrings(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i + 2);
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === "\\") i++; // skip escaped char
        i++;
      }
      i++; // closing quote
      out += quote + quote; // keep a placeholder so tokens don't merge
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Approximate per-file complexity: max brace depth, functions with >=6
 *  parameters, branch keywords per 100 normalized lines. */
function complexityOf(text, normLineCount) {
  const s = stripCommentsAndStrings(text);
  let depth = 0;
  let maxNesting = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") {
      depth++;
      if (depth > maxNesting) maxNesting = depth;
    } else if (s[i] === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  let manyParamFns = 0;
  const paramGroups = [
    ...s.matchAll(/\bfunction\s*\w*\s*\(([^()]*)\)/g),
    ...s.matchAll(/\(([^()]*)\)\s*=>/g),
  ];
  for (const m of paramGroups) {
    const inner = m[1].trim();
    if (!inner) continue;
    // Comma-split is approximate (destructuring inflates it) — stated as such.
    if (inner.split(",").length >= 6) manyParamFns++;
  }
  const branches = (s.match(/\b(if|for|while|case|catch)\b|&&|\|\|/g) || []).length;
  const branchesPer100 = normLineCount > 0 ? Math.round((branches / normLineCount) * 100) : 0;
  return { maxNesting, manyParamFns, branchesPer100 };
}

// --- scoring + framing ----------------------------------------------------------

function sizeTierOf(lines) {
  if (lines > SIZE_FLAG) return "flag";
  if (lines > SIZE_WARN) return "warn";
  if (lines > SIZE_NOTICE) return "notice";
  return null;
}

/** Collapse-candidate weight: size × churn × duplication. Deliberately simple
 *  and deterministic — the ranking is the product, not a hidden model. Churn is
 *  sqrt-damped: size is the PRIMARY accretion measure, so a 2700-line monster
 *  with quiet churn must still outrank a mid-size file that changed often. */
function scoreOf(lines, churn, dupBlocks) {
  return Math.round((lines / 100) * (1 + Math.sqrt(churn)) * (1 + 2 * dupBlocks) * 10) / 10;
}

/** One-line clean-move framing — always "consider / check", never a command,
 *  and never a claim that doing it makes the code "good". */
function moveFor(cand) {
  const big = cand.lines > SIZE_NOTICE;
  const hot = cand.churn >= HOT_CHURN;
  const dup = cand.duplicateBlocks > 0;
  if (big && hot && dup)
    return "Top collapse candidate: big, hot, and self-repeating — worth splitting along its seams AND folding the repeated blocks into one place before the next feature lands here.";
  if (big && hot)
    return "Big and hot: agents keep building on top of this file — consider splitting it along its natural seams before adding more.";
  if (big && dup)
    return "Oversized with repeated blocks — a candidate to break into smaller modules and collapse the copies into one shared helper.";
  if (dup)
    return "Repeated block: the same code lives in several places — consider collapsing the copies into one shared helper before they drift apart.";
  if (big)
    return "Oversized: consider extracting cohesive sections into their own modules — smaller files collide less across parallel agent lanes.";
  return "Churn magnet: check whether unrelated responsibilities are leaking into this file.";
}

// --- the command ------------------------------------------------------------------

/**
 * Run the accretion scan and print the human report.
 * @param {object} o
 * @param {string} o.cwd     repo root (any git repo — read-only)
 * @param {number} [o.top]   how many collapse candidates to rank (default 10)
 * @returns {{ exitCode: number, report: { summary: object, candidates: object[] } }}
 *   exitCode is ALWAYS 0 — accretion is advisory, never a gate.
 */
export function runArchitecture(o) {
  const cwd = o.cwd;
  const top = Math.max(1, Math.min(50, Number(o.top) || DEFAULT_TOP));

  section("Architecture — accretion scan (advisory, read-only)");
  console.log(
    `  ${c.gray("Where the codebase is being built OVER instead of collapsed — the signal")}`,
  );
  console.log(
    `  ${c.gray("an AI coding agent doesn't have. Measurement + heuristics; judgment stays human.")}`,
  );

  // 1. collect + read source files
  const rels = sourceFiles(cwd);
  const { counts: churn, commitsExamined } = churnCounts(cwd);

  const fileEntries = [];
  let totalLines = 0;
  for (const rel of rels) {
    const text = readText(path.join(cwd, rel));
    if (!text || looksGenerated(text)) continue;
    const lines = countLines(text);
    totalLines += lines;
    fileEntries.push({ rel, text, lines, norms: normalizeLines(text) });
  }

  // 2. duplication across the whole set
  const dup = findDuplication(fileEntries);

  // 3. per-file assembly
  const files = fileEntries.map((fe, i) => {
    const ext = path.extname(fe.rel).toLowerCase();
    return {
      rel: fe.rel,
      lines: fe.lines,
      sizeTier: sizeTierOf(fe.lines),
      churn: churn.get(fe.rel) || 0,
      duplicateBlocks: dup[i].blocks.length,
      dupBlocks: dup[i].blocks,
      sharedWith: dup[i].sharedWith.map((j) => fileEntries[j].rel),
      complexity: JS_EXT.has(ext) ? complexityOf(fe.text, fe.norms.length) : null,
    };
  });

  const oversized = {
    notice: files.filter((f) => f.sizeTier === "notice").length,
    warn: files.filter((f) => f.sizeTier === "warn").length,
    flag: files.filter((f) => f.sizeTier === "flag").length,
  };
  const totalDupBlocks = files.reduce((n, f) => n + f.duplicateBlocks, 0);
  const hotFiles = files.filter((f) => f.churn >= HOT_CHURN).length;

  console.log("");
  console.log(`  ${c.gray("scanned:")} ${c.bold(String(files.length))} source files · ${c.bold(totalLines.toLocaleString("en-US"))} lines`);
  console.log(
    `  ${c.gray("oversized:")} ${oversized.notice + oversized.warn + oversized.flag} files >${SIZE_NOTICE} lines` +
      ` (${oversized.warn + oversized.flag} >${SIZE_WARN} · ${oversized.flag} >${SIZE_FLAG})`,
  );
  console.log(
    `  ${c.gray("duplication:")} ${totalDupBlocks} repeated block(s) — ≥${DUP_WINDOW} similar lines appearing ≥${DUP_MIN_OCCURRENCES}× ${c.gray("(exact/near-exact repetition, approximate)")}`,
  );
  console.log(`  ${c.gray("churn window:")} last ${commitsExamined} commit(s)`);

  // 4. candidates: anything oversized, duplicated, or hot-and-nontrivial
  const candidates = files
    .filter(
      (f) =>
        f.lines > SIZE_NOTICE ||
        f.duplicateBlocks > 0 ||
        (f.churn >= HOT_CHURN && f.lines >= 300),
    )
    .map((f) => ({ ...f, score: scoreOf(f.lines, f.churn, f.duplicateBlocks) }))
    .sort((a, b) => b.score - a.score || b.lines - a.lines)
    .slice(0, top);

  const band =
    oversized.flag > 0 || files.some((f) => f.sizeTier === "warn" && f.churn >= HOT_CHURN) || totalDupBlocks >= 5
      ? "severe"
      : candidates.length > 0
        ? "notable"
        : "quiet";

  // 5. render candidates
  section(`Collapse candidates (top ${Math.min(top, candidates.length) || 0})`);
  if (candidates.length === 0) {
    console.log(`  ${c.gray("No files above the accretion thresholds in this scan.")}`);
  }
  const jsonCandidates = [];
  candidates.forEach((f, i) => {
    const signals = [];
    signals.push(`${f.lines} lines${f.sizeTier ? ` (${f.sizeTier} tier: >${f.sizeTier === "flag" ? SIZE_FLAG : f.sizeTier === "warn" ? SIZE_WARN : SIZE_NOTICE})` : ""}`);
    if (commitsExamined > 0) signals.push(`changed in ${f.churn} of the last ${commitsExamined} commits`);
    if (f.duplicateBlocks > 0) {
      const where = f.sharedWith.length
        ? ` (shared with ${f.sharedWith.slice(0, 2).join(", ")}${f.sharedWith.length > 2 ? ", …" : ""})`
        : " (repeated within this file)";
      const first = f.dupBlocks[0];
      signals.push(`${f.duplicateBlocks} duplicated block(s), e.g. lines ${first.from}–${first.to}${where}`);
    }
    if (f.complexity) {
      const cx = [];
      if (f.complexity.maxNesting >= 7) cx.push(`nesting depth ${f.complexity.maxNesting}`);
      if (f.complexity.manyParamFns > 0) cx.push(`${f.complexity.manyParamFns} function(s) with 6+ params`);
      if (f.complexity.branchesPer100 >= 30) cx.push(`${f.complexity.branchesPer100} branches/100 lines`);
      if (cx.length) signals.push(`approx. complexity: ${cx.join(", ")}`);
    }
    const move = moveFor(f);
    console.log(`  ${c.bold(String(i + 1) + ".")} ${c.cyan(f.rel)}`);
    console.log(`       ${signals.join(" · ")}`);
    console.log(`       ${c.gray("→ " + move)}`);
    jsonCandidates.push({
      rank: i + 1,
      file: f.rel,
      lines: f.lines,
      sizeTier: f.sizeTier,
      churn: f.churn,
      duplicateBlocks: f.duplicateBlocks,
      duplicateRanges: f.dupBlocks.map((b) => `${b.from}-${b.to}`),
      sharedWith: f.sharedWith,
      complexity: f.complexity,
      score: f.score,
      signals,
      move,
    });
  });

  // 6. verdict — honest, advisory
  section("Verdict");
  if (candidates.length > 0) {
    console.log(
      `  Accretion surfaced in ${c.bold(String(candidates.length))} file(s). This is a ${c.bold("measurement")}, not a` ,
    );
    console.log(`  judgment — a human (or your agent, now informed) decides what to collapse.`);
  } else {
    console.log(`  No accretion signals above the thresholds in this scan. That means these`);
    console.log(`  heuristics found nothing to flag — ${c.bold("not")} that the architecture is clean.`);
  }
  console.log(`  ${c.gray("Advisory only — accretion never blocks a ship (exit 0).")}`);

  const summary = {
    filesScanned: files.length,
    sourceLines: totalLines,
    commitsExamined,
    oversized,
    duplicateBlocks: totalDupBlocks,
    hotFiles,
    band, // quiet | notable | severe — how loud the signals are, NOT code quality
  };
  return { exitCode: 0, report: { summary, candidates: jsonCandidates } };
}

// --- the quiet advisory line for `check` -----------------------------------------
// Size + churn ONLY (no duplication pass — must stay cheap inside the gate).
// Returns a one-line string when a SEVERE hotspot exists, else null. Never
// throws; never affects check's results array, verdict, or exit code.

export function architectureAdvisory(cwd) {
  try {
    const { counts: churn } = churnCounts(cwd);
    let severe = 0;
    for (const rel of sourceFiles(cwd)) {
      const text = readText(path.join(cwd, rel));
      if (!text || looksGenerated(text)) continue;
      const lines = countLines(text);
      if (lines > SIZE_FLAG || (lines > SIZE_WARN && (churn.get(rel) || 0) >= HOT_CHURN)) severe++;
    }
    if (severe === 0) return null;
    return `architecture: ${severe} large/hot file(s) accreting — run \`getadvantage architecture\``;
  } catch {
    return null;
  }
}
