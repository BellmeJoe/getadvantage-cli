// getAdvantage CLI — MCP SERVER (`getadvantage mcp`).
//
// A dependency-free Model Context Protocol (MCP) server over stdio, so an AI
// agent IN THE LOOP — Claude Code, Cursor, any MCP client — can call
// getAdvantage's brain + checks + read-only maps (map, architecture)
// MID-SESSION, without leaving the chat. Same engine as the CLI; just
// reachable as tools.
//
// MCP framing here is newline-delimited JSON-RPC 2.0: one JSON object per line
// read from stdin, one response object written per line to stdout. We implement
// the minimum a client needs:
//   • initialize                     → protocolVersion + capabilities + serverInfo
//   • notifications/initialized      → a notification (no id) — no response
//   • tools/list                     → the tool catalogue
//   • tools/call                     → run a tool, return {content:[{type:"text"}]}
//
// CRITICAL (hard): stdout is the PROTOCOL channel — only JSON-RPC may go there.
// The CLI modules we reuse print to stdout via console.log; if that leaked into
// the stream it would corrupt the protocol. So every tool call runs inside a
// captureStdout() shim that redirects console.log / console.info / console.error /
// process.stdout.write into a buffer, and we return that buffer as the tool's
// text. Our OWN diagnostics go to stderr (logErr), which clients surface as logs.
//
// Honesty: this exposes the same read-and-report engine the CLI runs locally —
// it reaches no network, needs no API key, and writes only the brief/handoff
// files the matching commands already write. Nothing leaves your machine.
//
// Node built-ins only. ESM.

import { randomBytes } from "node:crypto";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile, repoRoot } from "./util.mjs";
import { runBrief, briefStaleness, DEFAULT_OUT } from "./brief.mjs";
import { runHandoff, DEFAULT_HANDOFF } from "./handoff.mjs";
import { runChecks } from "./checks-runner.mjs";
import { runGauge } from "./gauge.mjs";
import { renderMap } from "./overviews.mjs";
import { runArchitecture } from "./architecture.mjs";
import {
  decide,
  loadApprovalsPolicy,
  buildProofRecord,
  appendProofRecord,
  sanitizeRecordId,
  EXIT,
  MATCH_KEYS,
  credentialProofField,
  omitCredentialShaped,
} from "./approve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL_VERSION = "2024-11-05";

function pkgVersion() {
  const { json } = readJsonFile(path.join(__dirname, "package.json"));
  return json && typeof json.version === "string" ? json.version : "0.0.0";
}

// ---------------------------------------------------------------------------
// stdout capture — keep the imported CLI modules from corrupting the protocol.
// ---------------------------------------------------------------------------
// We force colour OFF for captured output (util.mjs already disables ANSI on a
// non-TTY stdout, which is always the case under a piped MCP client, so the
// captured text is clean for the agent to read).
function captureStdout(fn) {
  const out = [];
  const origLog = console.log;
  const origInfo = console.info;
  const origErr = console.error;
  const origWarn = console.warn;
  const origWrite = process.stdout.write;
  const push = (...args) => {
    out.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  console.log = push;
  console.info = push;
  console.error = push;
  console.warn = push;
  // Intercept any raw process.stdout.write too (vercel-style direct writes).
  process.stdout.write = function (chunk) {
    out.push(typeof chunk === "string" ? chunk.replace(/\n$/, "") : String(chunk));
    return true;
  };
  let result;
  let error;
  try {
    result = fn();
  } catch (e) {
    error = e;
  } finally {
    console.log = origLog;
    console.info = origInfo;
    console.error = origErr;
    console.warn = origWarn;
    process.stdout.write = origWrite;
  }
  return { text: out.join("\n"), result, error };
}

/** Diagnostics → stderr ONLY (never stdout — that's the protocol channel). */
function logErr(msg) {
  try {
    process.stderr.write(`[getadvantage mcp] ${msg}\n`);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// resolve the working repo for a tool call
// ---------------------------------------------------------------------------
// Each tool accepts an optional `cwd` (default process.cwd()). We resolve to the
// git repo root from there so the engine behaves exactly like the CLI does.
function resolveRepo(args) {
  const start = args && typeof args.cwd === "string" && args.cwd ? args.cwd : process.cwd();
  try {
    return { cwd: repoRoot(start), error: null };
  } catch {
    return {
      cwd: null,
      error: `Not inside a git repository at ${start}. getAdvantage runs in your project's repo — pass a "cwd" inside a git repo.`,
    };
  }
}

// ---------------------------------------------------------------------------
// approve_action authority pin — startup git root, not caller-supplied cwd.
// Other tools still use resolveRepo(args). This door is the one that
// authorizes, so the caller cannot pick the rulebook.
// ---------------------------------------------------------------------------
function canonicalizeGitRoot(start) {
  const root = repoRoot(start);
  let abs;
  try {
    abs = realpathSync(root);
  } catch {
    abs = path.resolve(root);
  }
  abs = path.resolve(abs);
  if (abs.length > 3 && (abs.endsWith(path.sep) || abs.endsWith("/"))) {
    abs = abs.replace(/[/\\]+$/, "");
  }
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

let STARTUP_REPO = null;

function pinStartupRepo() {
  if (STARTUP_REPO) return STARTUP_REPO;
  const start = process.cwd();
  try {
    const display = repoRoot(start);
    STARTUP_REPO = { root: canonicalizeGitRoot(display), display, error: null };
  } catch {
    STARTUP_REPO = {
      root: null,
      display: null,
      error: `Not inside a git repository at ${start}. getAdvantage runs in your project's repo.`,
    };
  }
  return STARTUP_REPO;
}

function foreignCwdRefusal() {
  return [
    "This approval was not checked. The path you passed is a different git repository from the one this server was started in.",
    "Approvals use that repository's committed policy. A tool call cannot pick a different folder's rules.",
    "Start getadvantage mcp in the repository whose policy should decide, or omit cwd.",
  ].join("\n");
}

function pinApproveAuthority(args) {
  const startup = pinStartupRepo();
  if (startup.error) return { cwd: null, error: startup.error };

  const requested = args && typeof args.cwd === "string" && args.cwd.trim() ? args.cwd.trim() : "";
  if (!requested) return { cwd: startup.display, error: null };

  let requestedRoot;
  try {
    requestedRoot = canonicalizeGitRoot(requested);
  } catch {
    return { cwd: null, error: foreignCwdRefusal() };
  }
  if (requestedRoot !== startup.root) {
    return { cwd: null, error: foreignCwdRefusal() };
  }
  return { cwd: startup.display, error: null };
}

// ---------------------------------------------------------------------------
// tool catalogue
// ---------------------------------------------------------------------------
const CWD_PROP = {
  cwd: {
    type: "string",
    description:
      "Optional absolute path to the project repo. Defaults to the server's current working directory. The tool resolves the git repo root from here.",
  },
};

const TOOLS = [
  {
    name: "get_brief",
    description:
      "Read the project's PROJECT-BRIEF.md (the portable, repo-resident 'project brain' — what this project IS: stack, architecture map, how to work here, current git state). If it's missing, generate it first from the real repo, then return it. Read this to get up to speed on the project mid-session.",
    inputSchema: { type: "object", properties: { ...CWD_PROP }, additionalProperties: false },
  },
  {
    name: "refresh_brief",
    description:
      "Regenerate PROJECT-BRIEF.md from the current repo (stack, API surface, integrations, schedules, git state) and return the refreshed brief. Run this after meaningful changes so the brain doesn't go stale.",
    inputSchema: { type: "object", properties: { ...CWD_PROP }, additionalProperties: false },
  },
  {
    name: "get_handoff",
    description:
      "Read the project's HANDOFF.md (the HOT 'where we left off right now' layer — what you were doing, next steps, open threads), if present. Returns a note if there's no handoff yet.",
    inputSchema: { type: "object", properties: { ...CWD_PROP }, additionalProperties: false },
  },
  {
    name: "save_handoff",
    description:
      "Refresh the brief AND write/update HANDOFF.md (a git-derived 'what changed since last time' plus the preserved human narrative), and append a session-ledger entry. Use this to save your place before switching sessions or models. Preserves any existing narrative; never overwrites a HANDOFF.md it didn't create.",
    inputSchema: { type: "object", properties: { ...CWD_PROP }, additionalProperties: false },
  },
  {
    name: "check",
    description:
      "Run the read-only pre-deploy checks (dirty-tree guard, secret scan, typecheck, schema-bump check, plus read-only API/integrations/schedules maps) and return a plain-language GO / NO-GO verdict with the findings. Nothing is mutated. Run this before deploying.",
    inputSchema: {
      type: "object",
      properties: {
        ...CWD_PROP,
        build: {
          type: "boolean",
          description: "Also run a full production build (npm run build), not just tsc --noEmit. Slower. Default false.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "map",
    description:
      "A read-only map of what the app has: project estate (modules, languages, dependencies, plus Vite/React/Supabase client orientation — evidence-only, not an RLS/security verdict), API surface (every route with methods + auth posture, ⚠ on mutating routes with no obvious gate; client SPAs get route-mapping-does-not-apply, never invented Express routes), agents & LLM integrations with their backing env keys, and schedules/crons. Orientation, never a verdict; mutates nothing. Run this to X-ray an unfamiliar repo mid-session. Same engine as the CLI `map` command.",
    inputSchema: { type: "object", properties: { ...CWD_PROP }, additionalProperties: false },
  },
  {
    name: "architecture",
    description:
      "The accretion scanner: where is the code being built OVER instead of collapsed? Ranks collapse candidates by size × churn × duplication (oversized files, git-churn hotspots, repeated ≥15-line blocks, approximate complexity) and reports a signal band (QUIET / NOTABLE / SEVERE). Read-only, advisory — it never refactors and never claims code is clean. Same engine as the CLI `architecture` command.",
    inputSchema: {
      type: "object",
      properties: {
        ...CWD_PROP,
        top: {
          type: "number",
          description: "How many collapse candidates to list (default 10).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "gauge",
    description:
      "A quick 'is this session getting heavy?' read — a heuristic from repo activity since the last handoff (commits + lines changed + time elapsed). Nudges a reset before things slow down. It is NOT a read of your context window or token count.",
    inputSchema: { type: "object", properties: { ...CWD_PROP }, additionalProperties: false },
  },
  {
    name: "approve_action",
    description:
      "Ask whether one proposed action is allowed, blocked, or waiting on a named person. Uses the committed .getadvantage/policy.json of the repository this server was started in. A cwd in a different repository is refused. Default is wait. Writes a local proof record (resource and summary as digests; a secret-shaped name is refused). Same as getadvantage approve. Not in the published package until a release.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Optional path inside the same git repository the server was started in. A path in a different repository is refused. Approvals always use the started-in repository's committed policy.",
        },
        action: {
          type: "string",
          description: "What the agent wants to do (for example file.read or db.write).",
        },
        resource: {
          type: "string",
          description: "The resource the action would touch (path, table, endpoint).",
        },
        actor: {
          type: "string",
          description: "Who is proposing the action (agent name, bot, or person).",
        },
        dataClass: {
          type: "string",
          description: "Data class of the resource (public, internal, regulated). Omit if unknown; unknown is never allowed by a wildcard rule.",
        },
        model: {
          type: "string",
          description: "Model that proposed the action, if known.",
        },
        summary: {
          type: "string",
          description: "Optional one-line description. Stored as a digest only; never written in the clear.",
        },
        tool: {
          type: "string",
          description: "The agent tool that would perform the action (for example bash or write).",
        },
      },
      required: ["action", "resource", "actor"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// approve_action — same decide() engine as `getadvantage approve`. The MCP
// door maps flat tool arguments onto the stage A descriptor and writes the
// same proof record. It does not accept a policy, a trusted flag, a decision,
// or a record id from the caller.
// ---------------------------------------------------------------------------
function ownString(obj, key) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return "";
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return "";
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function descriptorFromToolArgs(args) {
  const desc = Object.create(null);
  for (const key of MATCH_KEYS) desc[key] = ownString(args, key);
  desc.summary = ownString(args, "summary");
  return desc;
}

function makeDecisionId(now, nonce) {
  const stamp = String(now).replace(/[:.]/g, "-");
  return sanitizeRecordId(`dec-${stamp}-${nonce}`);
}

function machineBlock(fields) {
  return JSON.stringify(
    omitCredentialShaped({
      decision: fields.decision,
      id: fields.id,
      reason: fields.reason,
      escalateTo: fields.escalateTo ?? null,
      exitCode: fields.exitCode,
    }),
  );
}

function noteFromWarning(w) {
  const s = String(w || "");
  if (/nothing is allowed automatically/i.test(s)) {
    return "No .getadvantage/policy.json is committed, so nothing is allowed automatically.";
  }
  if (/not tracked or staged/i.test(s)) {
    return ".getadvantage/policy.json is not tracked or staged in git, so those rules are not applied.";
  }
  if (/working tree differs/i.test(s)) {
    return ".getadvantage/policy.json working tree differs from the git index. Only the staged content authorizes.";
  }
  if (/unsupported version/i.test(s)) {
    const m = s.match(/unsupported version (\S+)/i);
    const ver = m ? m[1] : null;
    return ver
      ? `.getadvantage/policy.json version ${ver} is not supported, so those rules are not applied.`
      : ".getadvantage/policy.json version is not supported, so those rules are not applied.";
  }
  if (/could not be read/i.test(s)) {
    return ".getadvantage/policy.json is in git but could not be read, so those rules are not applied.";
  }
  return null;
}

function formatApproveActionText({ decision, id, warnings }) {
  const lines = [];
  if (decision.outcome === "allow") {
    lines.push("This action is allowed.");
    if (decision.ruleId) {
      lines.push("A committed policy rule allowed this action. This was a real yes.");
    } else {
      lines.push("The committed default permits unmatched actions. This was a real yes. That is not a missing check.");
    }
  } else if (decision.outcome === "block") {
    lines.push("This action is blocked.");
    lines.push("Nothing ran. The committed policy blocked this action.");
  } else {
    lines.push("This action is waiting on a person.");
    lines.push("Nothing ran. A person has to say yes or no.");
    if (decision.escalateTo) {
      lines.push(`Named person: ${decision.escalateTo}.`);
    } else {
      lines.push("No named person is configured to review this.");
    }
  }
  lines.push(`Why: ${decision.reason}`);
  if (id) lines.push(`Record: .getadvantage/approvals/${id}.jsonl`);
  for (const w of warnings || []) {
    const note = noteFromWarning(w);
    if (note) lines.push(`Note: ${note}`);
  }
  lines.push("");
  lines.push(
    machineBlock({
      decision: decision.outcome,
      id,
      reason: decision.reason,
      escalateTo: decision.escalateTo,
      exitCode: EXIT[decision.outcome] ?? 2,
    }),
  );
  return lines.join("\n");
}

function toolFailureText(reason) {
  const safe = omitCredentialShaped({ ok: false, error: reason, id: null, exitCode: 1 });
  const why =
    typeof safe.error === "string" && safe.error ? safe.error : "The action was not allowed.";
  const lines = [
    "The action was not allowed.",
    `Why: ${why}`,
    "Nothing ran. This is not a recorded decision.",
    "",
    JSON.stringify(safe),
  ];
  return lines.join("\n");
}

function runApproveActionMcp(cwd, args) {
  const descriptor = descriptorFromToolArgs(args);
  if (!descriptor.action.trim() || !descriptor.resource.trim() || !descriptor.actor.trim()) {
    return { isError: true, text: toolFailureText("Need action, resource and actor.") };
  }

  const credField = credentialProofField(descriptor);
  if (credField) {
    return {
      isError: true,
      text: toolFailureText(
        `The ${credField} value looks like a secret, so it was not stored and this action was not allowed. Pass a name, not a key.`,
      ),
    };
  }

  let loaded;
  try {
    loaded = loadApprovalsPolicy(cwd);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      isError: true,
      text: toolFailureText(`The approval policy could not be read (${msg}).`),
    };
  }
  if (!loaded.ok) {
    const reason =
      loaded.error && /could not be read/i.test(loaded.error)
        ? loaded.error
        : "The approval policy could not be used. Fix .getadvantage/policy.json, commit it, then try again.";
    return {
      isError: true,
      text: toolFailureText(reason),
    };
  }

  const decision = decide(descriptor, loaded.policy);
  const now = new Date().toISOString();
  const nonce = randomBytes(4).toString("hex");
  const id = makeDecisionId(now, nonce);
  let record;
  try {
    record = buildProofRecord({
      kind: "decision",
      id,
      decision,
      descriptor,
      now,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { isError: true, text: toolFailureText(msg) };
  }
  try {
    appendProofRecord(cwd, record);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e && e.code === "PROOF_PARTIAL_WRITE") {
      const safe = omitCredentialShaped({ ok: false, error: msg, id, exitCode: 1 });
      const why =
        typeof safe.error === "string" && safe.error ? safe.error : "The action was not completed.";
      return {
        isError: true,
        text: [
          "The action was not completed.",
          `Why: ${why}`,
          "A ledger line was written. This is an incomplete recorded decision.",
          "",
          JSON.stringify(safe),
        ].join("\n"),
      };
    }
    return {
      isError: true,
      text: toolFailureText(
        `The decision could not be recorded (${msg}). Check that .getadvantage/approvals/ can be written.`,
      ),
    };
  }
  return {
    isError: false,
    text: formatApproveActionText({
      decision,
      id,
      warnings: loaded.warnings,
    }),
  };
}

// ---------------------------------------------------------------------------
// tool implementations — each returns a plain text string (the tool result)
// ---------------------------------------------------------------------------
function readTextSafe(abs) {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

const TOOL_IMPL = {
  get_brief(cwd) {
    const briefAbs = path.join(cwd, DEFAULT_OUT);
    if (!existsSync(briefAbs)) {
      // Generate it (writes the file). Suppress the function's stdout chatter.
      captureStdout(() => runBrief({ cwd }));
    }
    const body = readTextSafe(briefAbs);
    if (body == null) {
      return `Could not read or generate ${DEFAULT_OUT} in ${cwd}.`;
    }
    return body;
  },

  refresh_brief(cwd) {
    const briefAbs = path.join(cwd, DEFAULT_OUT);
    captureStdout(() => runBrief({ cwd }));
    const body = readTextSafe(briefAbs);
    if (body == null) {
      return `Refreshed, but could not read ${DEFAULT_OUT} back from ${cwd}.`;
    }
    return `Refreshed ${DEFAULT_OUT}.\n\n${body}`;
  },

  get_handoff(cwd) {
    const handoffAbs = path.join(cwd, DEFAULT_HANDOFF);
    const body = readTextSafe(handoffAbs);
    if (body == null) {
      return `No ${DEFAULT_HANDOFF} yet in ${cwd}. Use the save_handoff tool to create one (it records where work left off so the next session picks up with no loss).`;
    }
    return body;
  },

  save_handoff(cwd) {
    const { text, result } = captureStdout(() => runHandoff({ cwd }));
    const handoffAbs = path.join(cwd, DEFAULT_HANDOFF);
    const body = readTextSafe(handoffAbs);
    const log = text.trim();
    if (result !== 0 || body == null) {
      // runHandoff refuses to clobber a foreign HANDOFF.md (returns 1) — relay it.
      return `Handoff did not complete.\n${log || "(no output)"}`;
    }
    return `${log ? log + "\n\n" : ""}--- ${DEFAULT_HANDOFF} ---\n\n${body}`;
  },

  async check(cwd, args) {
    const { text, result, error } = await captureAsync(() =>
      runChecks({
        cwd,
        runBuild: !!(args && args.build),
        overview: true,
        briefCheck: true,
      }),
    );
    if (error) {
      return `Checks crashed: ${error.stack || error}`;
    }
    const verdict = result && result.exitCode === 0 ? "GO" : "NO-GO";
    const log = text.trim();
    return `Verdict: ${verdict}\n\n${log}`;
  },

  map(cwd) {
    // ONE implementation: the same renderMap the CLI `map` command uses.
    const { text, error } = captureStdout(() => renderMap(cwd));
    if (error) return `Map failed: ${error.message || error}`;
    return text.trim() || "(no map output)";
  },

  architecture(cwd, args) {
    const { text, error } = captureStdout(() =>
      runArchitecture({ cwd, top: args && typeof args.top === "number" ? args.top : undefined }),
    );
    if (error) return `Architecture scan failed: ${error.message || error}`;
    return text.trim() || "(no architecture output)";
  },

  gauge(cwd) {
    // In MCP context the agent has this server's own tools, not a shell — so
    // the nudge points at save_handoff, never at a CLI command it can't run.
    const { text } = captureStdout(() => runGauge({ cwd, saveHint: "the save_handoff tool" }));
    return text.trim() || "(no gauge output)";
  },

  approve_action(cwd, args) {
    // STDOUT PURITY: approve.mjs prints via console.log on the CLI path.
    // This door must never let that (or anything else) touch the JSON-RPC
    // channel. captureStdout is the same shim every other tool uses.
    const { result, error } = captureStdout(() => runApproveActionMcp(cwd, args));
    if (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        text: toolFailureText(`Could not finish the approval decision (${msg}).`),
      };
    }
    if (result && typeof result === "object" && typeof result.text === "string") {
      return { isError: !!result.isError, text: result.text };
    }
    return { isError: true, text: toolFailureText("Could not finish the approval decision.") };
  },
};

/** Async variant of captureStdout — `runChecks` is async (it may run a build). */
async function captureAsync(fn) {
  const out = [];
  const origLog = console.log;
  const origInfo = console.info;
  const origErr = console.error;
  const origWarn = console.warn;
  const origWrite = process.stdout.write;
  const push = (...args) => {
    out.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  console.log = push;
  console.info = push;
  console.error = push;
  console.warn = push;
  process.stdout.write = function (chunk) {
    out.push(typeof chunk === "string" ? chunk.replace(/\n$/, "") : String(chunk));
    return true;
  };
  let result;
  let error;
  try {
    result = await fn();
  } catch (e) {
    error = e;
  } finally {
    console.log = origLog;
    console.info = origInfo;
    console.error = origErr;
    console.warn = origWarn;
    process.stdout.write = origWrite;
  }
  return { text: out.join("\n"), result, error };
}

// ---------------------------------------------------------------------------
// JSON-RPC plumbing
// ---------------------------------------------------------------------------
function writeMessage(obj) {
  // One JSON object per line on stdout — the ONLY thing allowed on stdout.
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (e) {
    logErr(`failed to write response: ${e.message || e}`);
  }
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: "2.0", id, error: err };
}

/**
 * Enforce a tool's inputSchema (type: object, properties, additionalProperties:false).
 * Returns null if ok, or an error string for -32602 (finding: mcp-schema-not-enforced).
 */
function validateToolArgs(toolDef, args) {
  const schema = toolDef && toolDef.inputSchema;
  if (!schema || schema.type !== "object") return null;
  const raw = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const props = schema.properties || {};
  const allowed = new Set(Object.keys(props));

  if (schema.additionalProperties === false) {
    const extras = Object.keys(raw).filter((k) => !allowed.has(k));
    if (extras.length) {
      return `Invalid params: unexpected propert${extras.length === 1 ? "y" : "ies"}: ${extras.join(", ")}`;
    }
  }

  for (const [key, prop] of Object.entries(props)) {
    if (!(key in raw) || raw[key] === undefined) continue;
    const v = raw[key];
    if (prop.type === "string" && typeof v !== "string") {
      return `Invalid params: "${key}" must be a string`;
    }
    if (prop.type === "boolean" && typeof v !== "boolean") {
      return `Invalid params: "${key}" must be a boolean`;
    }
    if (prop.type === "number" && typeof v !== "number") {
      return `Invalid params: "${key}" must be a number`;
    }
  }

  if (Array.isArray(schema.required)) {
    for (const req of schema.required) {
      if (!(req in raw) || raw[req] === undefined || raw[req] === null) {
        return `Invalid params: missing required property "${req}"`;
      }
    }
  }
  return null;
}

async function handleToolsCall(id, params) {
  const name = params && typeof params.name === "string" ? params.name : undefined;
  const args = (params && params.arguments) || {};
  if (!name) {
    return rpcError(id, -32602, "Unknown tool: (name missing)");
  }
  const toolDef = TOOLS.find((t) => t.name === name);
  const impl = TOOL_IMPL[name];
  if (!toolDef || !impl) {
    return rpcError(id, -32602, `Unknown tool: ${name}`);
  }

  const schemaErr = validateToolArgs(toolDef, args);
  if (schemaErr) {
    return rpcError(id, -32602, schemaErr);
  }

  let cwd;
  if (name === "approve_action") {
    const pinned = pinApproveAuthority(args);
    if (pinned.error) {
      return rpcResult(id, { content: [{ type: "text", text: pinned.error }], isError: true });
    }
    cwd = pinned.cwd;
  } else {
    const resolved = resolveRepo(args);
    if (resolved.error) {
      // Surface as a tool error (isError), not a transport error — the agent can
      // read the message and retry with a valid cwd.
      return rpcResult(id, { content: [{ type: "text", text: resolved.error }], isError: true });
    }
    cwd = resolved.cwd;
  }

  try {
    const text = await impl(cwd, args);
    if (text && typeof text === "object" && typeof text.text === "string") {
      const payload = { content: [{ type: "text", text: text.text }] };
      if (text.isError) payload.isError = true;
      return rpcResult(id, payload);
    }
    return rpcResult(id, { content: [{ type: "text", text: String(text) }] });
  } catch (e) {
    logErr(`tool ${name} failed: ${e.stack || e}`);
    const raw = e && e.message ? e.message : String(e);
    const safeMsg = omitCredentialShaped(raw);
    const shown = typeof safeMsg === "string" && safeMsg ? safeMsg : "the action was not allowed";
    return rpcResult(id, {
      content: [{ type: "text", text: `Tool "${name}" failed: ${shown}` }],
      isError: true,
    });
  }
}

async function handleMessage(msg) {
  // A response with no method, or a malformed object → ignore (we only act on
  // requests/notifications from the client).
  if (!msg || typeof msg !== "object") return null;
  const { id, method, params } = msg;

  // Notifications have no id and expect NO response.
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "getadvantage", version: pkgVersion() },
    });
  }

  if (method === "notifications/initialized" || method === "initialized") {
    // No-op notification — do not respond.
    return null;
  }

  if (method === "ping") {
    // Health check some clients send — empty result.
    return isNotification ? null : rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    return handleToolsCall(id, params);
  }

  // Unknown method.
  if (isNotification) {
    logErr(`ignoring unknown notification: ${method}`);
    return null;
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

/**
 * `getadvantage mcp` — run the MCP server over stdio. Blocks, reading
 * newline-delimited JSON-RPC from stdin until the stream closes.
 * @returns {Promise<number>} exit code (0 on a clean stdin close)
 */
export function runMcp() {
  pinStartupRepo();
  logErr(`getadvantage MCP server v${pkgVersion()} — stdio, protocol ${PROTOCOL_VERSION}. Reading JSON-RPC on stdin.`);

  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");

    // Serialize message handling so async tool calls don't interleave their
    // responses — process one line fully before the next.
    let queue = Promise.resolve();
    const enqueue = (line) => {
      queue = queue.then(async () => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let msg;
        try {
          msg = JSON.parse(trimmed);
        } catch (e) {
          logErr(`could not parse line as JSON: ${e.message || e}`);
          return;
        }
        try {
          const reply = await handleMessage(msg);
          if (reply) writeMessage(reply);
        } catch (e) {
          logErr(`handler error: ${e.stack || e}`);
          // Best-effort transport error if it was a request.
          if (msg && msg.id !== undefined && msg.id !== null) {
            writeMessage(rpcError(msg.id, -32603, `Internal error: ${e.message || e}`));
          }
        }
      });
    };

    process.stdin.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        enqueue(line);
      }
    });

    process.stdin.on("end", () => {
      // Flush any trailing partial line, then drain the queue and exit.
      if (buf.trim()) enqueue(buf);
      buf = "";
      queue.then(() => {
        logErr("stdin closed — shutting down.");
        resolve(0);
      });
    });

    process.stdin.on("error", (e) => {
      logErr(`stdin error: ${e.message || e}`);
      resolve(1);
    });

    // If stdin is not readable at all (e.g. no pipe), resume so 'end' can fire.
    process.stdin.resume();
  });
}
