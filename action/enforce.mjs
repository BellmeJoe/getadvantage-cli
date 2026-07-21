// getAdvantage Action — final required-check enforcer.
//
// Pure decision + CLI entry used by action.yml so upload honesty is testable:
//   - gate GO + successful gate + (no upload needed | upload success | fork skip) → exit 0
//   - SARIF upload attempted and failed → exit 1 (never green)
//   - gate NO-GO / ERROR → exit 1 even if upload succeeded
//
// Node built-ins only. ESM.

import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {object} o
 * @param {string} [o.verdict] GO | NO-GO | ERROR
 * @param {string} [o.gateOutcome] success | failure | cancelled | skipped
 * @param {string|boolean} [o.sarifWritten]
 * @param {string|boolean} [o.uploadSkip] true when fork limitation detected
 * @param {string} [o.uploadOutcome] success | failure | cancelled | skipped | ''
 * @returns {{ exitCode: number, reason: string, message: string }}
 */
export function decideJobOutcome(o = {}) {
  const verdict = String(o.verdict || "").trim() || "ERROR";
  const gateOutcome = String(o.gateOutcome || "").trim();
  const sarifWritten = o.sarifWritten === true || o.sarifWritten === "true";
  // uploadSkip: explicit fork/platform skip (eligible=false while written=true),
  // or eligible=false / written=false meaning upload was never attempted.
  const uploadSkip = o.uploadSkip === true || o.uploadSkip === "true";
  const uploadEligible =
    o.uploadEligible === true ||
    o.uploadEligible === "true" ||
    (sarifWritten && !uploadSkip && o.uploadEligible !== false && o.uploadEligible !== "false");
  const uploadOutcome = String(o.uploadOutcome || "").trim();

  // When SARIF was written and upload was eligible, only outcome=success is green.
  // "skipped" is green only for an explicit, independently proven fork skip
  // (uploadSkip / !uploadEligible) — never when the upload step was eligible.
  if (sarifWritten && uploadEligible && !uploadSkip) {
    if (uploadOutcome === "success") {
      // proceed to gate verdict
    } else if (!uploadOutcome) {
      return {
        exitCode: 1,
        reason: "sarif-upload-missing",
        message:
          "getAdvantage: SARIF was written but upload outcome is missing — treating as upload failure (not GO).",
      };
    } else {
      // failure | cancelled | skipped | anything else while eligible → red
      return {
        exitCode: 1,
        reason: uploadOutcome === "skipped" ? "sarif-upload-skipped-eligible" : "sarif-upload-failed",
        message:
          uploadOutcome === "skipped"
            ? "getAdvantage: SARIF upload was skipped while eligible (not an explicit fork skip). Required check fails — eligible upload must succeed."
            : `getAdvantage: SARIF upload failed (outcome=${uploadOutcome}). Required check fails — upload attempt must not finish green.`,
      };
    }
  }

  if (verdict === "GO" && gateOutcome === "success") {
    return {
      exitCode: 0,
      reason: uploadSkip || !uploadEligible ? "go-upload-skipped-fork" : "go",
      message:
        uploadSkip || (sarifWritten && !uploadEligible)
          ? "getAdvantage: GO (SARIF upload skipped — fork PR / platform limitation; see job summary)."
          : "getAdvantage: GO",
    };
  }

  return {
    exitCode: 1,
    reason: verdict === "GO" ? "gate-not-success" : verdict || "ERROR",
    message: `getAdvantage: ${verdict || "ERROR"} (gate outcome=${gateOutcome || "unknown"}). Required check fails.`,
  };
}

/**
 * Whether this event is a fork pull_request where code-scanning upload is
 * typically unavailable with the default GITHUB_TOKEN (honest skip path).
 */
export function shouldSkipSarifUploadForFork(o = {}) {
  const eventName = String(o.eventName || "");
  if (eventName !== "pull_request" && eventName !== "pull_request_target") {
    return { skip: false, reason: "" };
  }
  const isFork = o.isFork === true || o.isFork === "true";
  const headRepo = String(o.headRepo || "").toLowerCase();
  const baseRepo = String(o.baseRepo || "").toLowerCase();
  if (isFork || (headRepo && baseRepo && headRepo !== baseRepo)) {
    return { skip: true, reason: "fork-pr" };
  }
  return { skip: false, reason: "" };
}

/** CLI entry for action.yml final step / upload-decide step. */
export function runEnforceFromEnv(env = process.env) {
  if (env.GETADVANTAGE_ENFORCE_MODE === "upload-decide") {
    const d = shouldSkipSarifUploadForFork({
      eventName: env.GITHUB_EVENT_NAME,
      isFork: env.GETADVANTAGE_PR_IS_FORK,
      headRepo: env.GETADVANTAGE_PR_HEAD_REPO,
      baseRepo: env.GITHUB_REPOSITORY,
    });
    const out = env.GITHUB_OUTPUT;
    if (out) {
      appendFileSync(out, `skip=${d.skip ? "true" : "false"}\n`, "utf8");
      appendFileSync(out, `reason=${d.reason || ""}\n`, "utf8");
    }
    if (d.skip) {
      console.log(
        "getAdvantage: skipping SARIF upload on fork PR (GitHub code-scanning limitation for untrusted forks). Not claiming upload succeeded.",
      );
      const summary = env.GITHUB_STEP_SUMMARY;
      if (summary) {
        appendFileSync(
          summary,
          "### getAdvantage SARIF upload\n\n" +
            "Skipped: fork `pull_request` cannot reliably upload SARIF with the default token. " +
            "Gate results remain in this job summary / logs. This is not a silent green upload.\n",
          "utf8",
        );
      }
    }
    return 0;
  }

  // GETADVANTAGE_UPLOAD_SKIP is true when fork/platform skip applies.
  // When false/empty and SARIF was written, upload was eligible/attempted.
  const uploadSkip = env.GETADVANTAGE_UPLOAD_SKIP === "true";
  const decision = decideJobOutcome({
    verdict: env.GETADVANTAGE_VERDICT,
    gateOutcome: env.GETADVANTAGE_GATE_OUTCOME,
    sarifWritten: env.GETADVANTAGE_SARIF_WRITTEN,
    uploadSkip,
    uploadEligible: env.GETADVANTAGE_SARIF_WRITTEN === "true" && !uploadSkip,
    uploadOutcome: env.GETADVANTAGE_UPLOAD_OUTCOME,
  });
  console.log(decision.message);
  if (decision.exitCode !== 0 && decision.reason === "sarif-upload-failed") {
    console.error("Findings may still be in logs/job summary; code scanning upload did not complete.");
  }
  return decision.exitCode;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  process.exit(runEnforceFromEnv(process.env));
}
