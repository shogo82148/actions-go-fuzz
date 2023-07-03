import * as core from "@actions/core";
import { fuzz, ReportMethodType, restoreCache } from "./run-impl";

function getReportMethod(): ReportMethodType {
  const method = core.getInput("report-method") || "pull-request";
  if (method !== "pull-request" && method !== "slack") {
    throw new Error("report-method must be either pull-request or security-vulnerability");
  }
  return method;
}

async function run(): Promise<void> {
  const repository = core.getInput("repository");
  const githubToken = core.getInput("token");
  const githubGraphqlUrl = process.env["GITHUB_GRAPHQL_URL"] || "https://api.github.com/graphql";
  const githubServerUrl = process.env["GITHUB_SERVER_URL"] || "https://github.com";
  const githubRunId = process.env["GITHUB_RUN_ID"];
  const githubRunAttempt = process.env["GITHUB_RUN_ATTEMPT"];
  const baseBranch = core.getInput("base-branch") || process.env["GITHUB_HEAD_REF"] || "main";
  const packages = core.getInput("packages").trim();
  const workingDirectory = core.getInput("working-directory");
  const fuzzRegexp = core.getInput("fuzz-regexp");
  const fuzzTime = core.getInput("fuzz-time");
  const fuzzMinimizeTime = core.getInput("fuzz-minimize-time");
  const reportMethod = getReportMethod();
  const headBranchPrefix = core.getInput("head-branch-prefix").trim();
  const webhookUrl = core.getInput("webhook-url");
  const options = {
    repository,
    githubToken,
    githubGraphqlUrl,
    githubServerUrl,
    githubRunId,
    githubRunAttempt,
    baseBranch,
    packages,
    workingDirectory,
    fuzzRegexp,
    fuzzTime,
    fuzzMinimizeTime,
    reportMethod,
    headBranchPrefix,
    webhookUrl,
  };

  try {
    await core.group("restore cache", async () => {
      await restoreCache(options);
    });
  } catch (error) {
    core.warning("error while restoring cache.");
    if (error instanceof Error) core.warning(error.message);
  }

  try {
    const result = await fuzz(options);
    core.setOutput("found", result.found ? "true" : "");
    core.setOutput("head-branch", result.headBranch);
    core.setOutput("pull-request-number", result.pullRequestNumber);
    core.setOutput("pull-request-url", result.pullRequestUrl);
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

void run();
