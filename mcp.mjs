// getAdvantage CLI — MCP SERVER (`getadvantage mcp`).
//
// A dependency-free Model Context Protocol (MCP) server over stdio, so an AI
// agent IN THE LOOP — Claude Code, Cursor, any MCP client — can call
// getAdvantage's brain + checks MID-SESSION, without leaving the chat. Same
// engine as the CLI; just reachable as tools.
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

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./util.mjs";
import { runBrief, briefStaleness, DEFAULT_OUT } from "./brief.mjs";
import { runHandoff, DEFAULT_HANDOFF } from "./handoff.mjs";
import { runChecks } from "./checks-runner.mjs";
import { runGauge } from "./gauge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL_VERSION = "2024-11-05";

function pkgVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
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
    name: "gauge",
    description:
      "A quick 'is this session getting heavy?' read — a heuristic from repo activity since the last handoff (commits + lines changed + time elapsed). Nudges a reset before things slow down. It is NOT a read of your context window or token count.",
    inputSchema: { type: "object", properties: { ...CWD_PROP }, additionalProperties: false },
  },
];

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

  gauge(cwd) {
    const { text } = captureStdout(() => runGauge({ cwd }));
    return text.trim() || "(no gauge output)";
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

async function handleToolsCall(id, params) {
  const name = params && params.name;
  const args = (params && params.arguments) || {};
  const impl = TOOL_IMPL[name];
  if (!impl) {
    return rpcError(id, -32602, `Unknown tool: ${name}`);
  }

  const { cwd, error } = resolveRepo(args);
  if (error) {
    // Surface as a tool error (isError), not a transport error — the agent can
    // read the message and retry with a valid cwd.
    return rpcResult(id, { content: [{ type: "text", text: error }], isError: true });
  }

  try {
    const text = await impl(cwd, args);
    return rpcResult(id, { content: [{ type: "text", text: String(text) }] });
  } catch (e) {
    logErr(`tool ${name} failed: ${e.stack || e}`);
    return rpcResult(id, {
      content: [{ type: "text", text: `Tool "${name}" failed: ${e.message || e}` }],
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
