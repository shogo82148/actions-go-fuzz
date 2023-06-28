import * as core from "@actions/core";
import { saveCache } from "./run-impl";

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
  const headBranchPrefix = core.getInput("head-branch-prefix").trim();
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
    headBranchPrefix,
  };

  try {
    await core.group("save cache", async () => {
      await saveCache(options);
    });
  } catch (error) {
    core.warning("error while saving cache.");
    if (error instanceof Error) core.warning(error.message);
  }
}

void run();
