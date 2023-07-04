import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as http from "@actions/http-client";
import * as cache from "@actions/cache";
import * as crypto from "crypto";
import fs from "fs/promises";

export const ReportMethod = {
  PullRequest: "pull-request",
  Slack: "slack",
} as const;

export type ReportMethodType = (typeof ReportMethod)[keyof typeof ReportMethod];

interface FuzzOptions {
  repository: string;
  githubToken: string;
  githubGraphqlUrl: string;
  githubServerUrl: string;
  githubRunId: string | undefined;
  githubRunAttempt: string | undefined;
  baseBranch: string;
  packages: string;
  workingDirectory: string;
  fuzzRegexp: string;
  fuzzTime: string;
  fuzzMinimizeTime: string;
  reportMethod: ReportMethodType;
  headBranchPrefix: string;
  webhookUrl: string;
}

interface SaveCacheOptions {
  packages: string;
  workingDirectory: string;
  fuzzRegexp: string;
}

interface FuzzResult {
  found: boolean;
  headBranch?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
}

export async function fuzz(options: FuzzOptions): Promise<FuzzResult> {
  const ignoreReturnCode = { cwd: options.workingDirectory, ignoreReturnCode: true };

  // start fuzzing
  const exitCode = await core.group("fuzzing", async () => {
    return await exec.exec(
      "go",
      [
        "test",
        `-fuzz=${options.fuzzRegexp}`,
        `-fuzztime=${options.fuzzTime}`,
        `-fuzzminimizetime=${options.fuzzMinimizeTime}`,
        options.packages,
      ],
      { cwd: options.workingDirectory, ignoreReturnCode: true }
    );
  });

  if (exitCode === 0) {
    // no fuzzing error, exit
    core.info("no fuzzing error");
    return {
      found: false,
    };
  }

  core.info("fuzzing error occurred");

  // generate report
  const report = await core.group("generating report", async () => {
    return await generateReport(options);
  });
  if (report == null) {
    core.info("no new fuzzing input found");
    return {
      found: false,
    };
  }

  // send the report
  const result = await core.group("send the report", async () => {
    return sendReport(options, report);
  });

  // cleanup
  await core.group("cleanup", async () => {
    await exec.exec("git", ["restore", "--staged", "."], ignoreReturnCode);
    await fs.unlink(report.newInputPath);
  });

  return result;
}

export async function restoreCache(options: SaveCacheOptions): Promise<void> {
  const cachePath = (await exec.getExecOutput("go", ["env", "GOCACHE"])).stdout.trim();
  const packageName = await getPackageName(options);
  const os = process.env["RUNNER_OS"] || "Unknown";
  await cache.restoreCache([`${cachePath}/fuzz`], `go-fuzz-${os}-${packageName}-${options.fuzzRegexp}-`, []);
}

export async function saveCache(options: SaveCacheOptions): Promise<void> {
  const cachePath = (await exec.getExecOutput("go", ["env", "GOCACHE"])).stdout.trim();
  const packageName = await getPackageName(options);
  const id = await getHeadRef();
  const os = process.env["RUNNER_OS"] || "Unknown";
  await cache.saveCache([`${cachePath}/fuzz`], `go-fuzz-${os}-${packageName}-${options.fuzzRegexp}-${id}`);
}

interface GenerateReportResult {
  // packageName is the name of the package that fails the fuzz test.
  packageName: string;

  // newInputPath is the path to the new input that fails the fuzz test.
  newInputPath: string;

  // newInputContents is the contents of the new input that fails the fuzz test.
  newInputContents: Buffer;

  // patch is the patch to reproduce the test failure.
  patch: string;

  // newInputName is the name of NewInputPath.
  newInputName: string;

  // testFunc is the name of the test function that fails the fuzz test.
  testFunc: string;

  // testCommand is the command to reproduce the test failure.
  testCommand: string;

  // testResult is the output of the test command.
  testResult: string;
}

async function generateReport(options: FuzzOptions): Promise<GenerateReportResult | null> {
  const ignoreReturnCode = { cwd: options.workingDirectory, ignoreReturnCode: true };

  const input = await getNewInput(options);
  if (input == null) {
    return null;
  }
  core.info(`new input found: ${input}`);

  const packageName = await getPackageName(options);

  const segments = input.path.split("/");
  const testFunc = segments[segments.length - 2];
  const newInputName = segments[segments.length - 1];

  const testResult = await exec.getExecOutput(
    "go",
    ["test", `-run=${testFunc}/${newInputName}`, options.packages],
    ignoreReturnCode
  );

  const contents = await fs.readFile(input.path);

  return {
    packageName,
    patch: input.patch,
    newInputPath: input.path,
    newInputContents: contents,
    newInputName,
    testFunc,
    testCommand: `go test -run=${testFunc}/${newInputName} ${options.packages}`,
    testResult: testResult.stdout,
  };
}

async function sendReport(options: FuzzOptions, report: GenerateReportResult): Promise<FuzzResult> {
  switch (options.reportMethod) {
    case ReportMethod.PullRequest:
      return await sendReportViaPR(options, report);
    case ReportMethod.Slack:
      return await sendReportViaSlack(options, report);
  }
}

async function sendReportViaPR(options: FuzzOptions, report: GenerateReportResult): Promise<FuzzResult> {
  const client = new http.HttpClient("shogo82148/actions-go-fuzz", [], {
    headers: {
      Authorization: `Bearer ${options.githubToken}`,
      "X-Github-Next-Global-ID": "1",
    },
  });
  const repositoryId = await getRepositoryId(client, options);
  core.debug(`repositoryId: ${repositoryId}`);

  // create a new branch
  const branchName = `${options.headBranchPrefix}/${report.packageName}/${report.testFunc}/${report.newInputName}`;
  const oid = await getHeadRef();
  const createBranchResult = await createBranch(client, options, {
    clientMutationId: newClientMutationId(),
    repositoryId,
    name: `refs/heads/${branchName}`,
    oid,
  });
  if (createBranchResult == null) {
    core.info("the report already exists. skip to report a new fuzz input.");
    return {
      found: false,
    };
  }

  // create a new commit
  await createCommit(client, options, {
    clientMutationId: newClientMutationId(),
    branch: {
      repositoryNameWithOwner: options.repository,
      branchName,
    },
    fileChanges: {
      additions: [
        {
          path: report.newInputPath,
          contents: report.newInputContents.toString("base64"),
        },
      ],
      deletions: [],
    },
    expectedHeadOid: oid,
    message: {
      headline: `Add a new fuzz input data for ${report.testFunc} in ${report.packageName}.`,
      body: `${"`"}${report.testCommand}${"`"} failed with the following output:

${"```"}
${report.testResult}
${"```"}

This fuzz data is generated by [actions-go-fuzz](https://github.com/shogo82148/actions-go-fuzz).
`,
    },
  });

  // create a new pull request
  const logUrl =
    options.githubRunId != null && options.githubRunAttempt != null
      ? `${options.githubServerUrl}/${options.repository}/actions/runs/${options.githubRunId}/attempts/${options.githubRunAttempt}`
      : undefined;
  const pullRequest = await createPullRequest(client, options, {
    clientMutationId: newClientMutationId(),
    repositoryId,
    headRepositoryId: repositoryId,
    baseRefName: options.baseBranch,
    headRefName: branchName,
    maintainerCanModify: true,
    draft: false,
    title: `${report.testFunc} in the package ${report.packageName} failed`,
    body: `${"`"}${report.testCommand}${"`"} failed with the following output:

${"```"}
${report.testResult}
${"```"}

---

This pull request is generated by [actions-go-fuzz](https://github.com/shogo82148/actions-go-fuzz).
${logUrl != null ? `\n[See the log](${logUrl}).` : ""}
`,
  });

  return {
    found: true,
    headBranch: branchName,
    pullRequestNumber: pullRequest.data.createPullRequest.pullRequest.number,
    pullRequestUrl: pullRequest.data.createPullRequest.pullRequest.url,
  };
}

interface GetNewInputOutput {
  path: string;
  patch: string;
}

async function getNewInput(options: FuzzOptions): Promise<GetNewInputOutput | null> {
  const cwd = { cwd: options.workingDirectory };
  const ignoreReturnCode = { cwd: options.workingDirectory, ignoreReturnCode: true };

  // get the top level directory of the working directory.
  const topLevel = (await exec.getExecOutput("git", ["rev-parse", "--show-toplevel"], cwd)).stdout.trim();

  // check whether there is any changes.
  await exec.exec("git", ["add", "."], cwd);
  const hasChange = await exec.exec("git", ["diff", "--cached", "--exit-code", "--quiet"], ignoreReturnCode);
  if (hasChange === 0) {
    return null;
  }

  // find new test corpus.
  const output = await exec.getExecOutput(
    "git",
    ["diff", "--name-only", "--cached", "--no-renames", "--diff-filter=d"],
    cwd
  );
  const testdata = output.stdout.split("\n").filter((file) => {
    const segments = file.split("/");
    return (
      segments.length >= 4 &&
      segments[segments.length - 4] === "testdata" &&
      segments[segments.length - 3] === "fuzz" &&
      segments[segments.length - 2].startsWith("Fuzz")
    );
  });
  if (testdata.length !== 1) {
    return null;
  }

  const newInput = testdata[0];

  // get the patch of the new test corpus.
  const patch = (await exec.getExecOutput("git", ["diff", "--cached", newInput], { cwd: topLevel })).stdout;

  // get the contents of the new test corpus.
  return {
    path: newInput,
    patch,
  };
}

// getRepositoryId gets the repository id from GitHub GraphQL API.
async function getRepositoryId(client: http.HttpClient, options: FuzzOptions): Promise<string> {
  const [owner, name] = options.repository.split("/");
  const query = {
    // ref. https://docs.github.com/en/graphql/reference/queries#repository
    query: `query ($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id
      }
    }`,
    variables: {
      owner,
      name,
    },
  };

  interface Response {
    data: {
      repository: {
        id: string;
      };
    };
    errors?: GraphQLError[];
  }

  const response = await client.postJson<Response>(options.githubGraphqlUrl, query);
  if (response.result == null) {
    throw new Error("failed to get repository id");
  }
  if (response.result.errors != null) {
    for (const error of response.result.errors) {
      core.error(error.message);
    }
    throw new Error("failed to get repository id");
  }
  return response.result.data.repository.id;
}

async function getHeadRef(): Promise<string> {
  const output = await exec.getExecOutput("git", ["rev-parse", "HEAD"]);
  return output.stdout.trim();
}

interface GetPackageOptions {
  packages: string;
  workingDirectory: string;
}

async function getPackageName(options: GetPackageOptions): Promise<string> {
  const output = await exec.getExecOutput("go", ["list", options.packages], { cwd: options.workingDirectory });
  const pkg = output.stdout.trim();
  return pkg;
}

function newClientMutationId(): string {
  return crypto.randomUUID();
}

interface GraphQLError {
  type: string;
  path: string[];
  locations: {
    line: number;
    column: number;
  }[];
  message: string;
}

// ref. https://docs.github.com/en/graphql/reference/input-objects#createrefinput
interface CreateBranchInput {
  // A unique identifier for the client performing the mutation.
  clientMutationId: string;

  // The Node ID of the Repository to create the Ref in.
  repositoryId: string;

  // The fully qualified name of the new Ref (ie: refs/heads/my_new_branch).
  name: string;

  // The GitObjectID that the new Ref shall target. Must point to a commit.
  oid: string;
}

interface CreateBranchOutput {
  data: {
    createRef: {
      // A unique identifier for the client performing the mutation.
      clientMutationId: string;
    };
  };

  errors?: GraphQLError[];
}

// createBranch creates a branch.
// it returns null if the branch already exists.
async function createBranch(
  client: http.HttpClient,
  options: FuzzOptions,
  input: CreateBranchInput
): Promise<CreateBranchOutput | null> {
  const query = {
    // ref. https://docs.github.com/en/graphql/reference/mutations#createref
    query: `mutation ($input: CreateRefInput!) {
      createRef(input: $input) {
        clientMutationId
      }
    }`,
    variables: {
      input,
    },
  };
  core.debug(`create a branch request: ${JSON.stringify(query)}`);

  const response = await client.postJson<CreateBranchOutput>(options.githubGraphqlUrl, query);
  core.debug(`create a branch response: ${JSON.stringify(response)}`);
  if (response.result == null) {
    throw new Error("failed to create a branch");
  }
  if (response.result.errors != null) {
    for (const error of response.result.errors) {
      if (error.type === "UNPROCESSABLE" && error.message.match(/already\s+exists/i)) {
        // suppress the error if the branch already exists.
        return null;
      }
      core.error(`failed to create a branch: ${error.message}`);
    }
    core.error(
      "please check whether the GitHub token has the write permission to the repository. " +
        "see https://github.com/shogo82148/actions-go-fuzz#permissions for more details."
    );
    throw new Error("failed to create a branch");
  }
  return response.result;
}

interface CreateCommitInput {
  clientMutationId: string;
  branch: {
    repositoryNameWithOwner: string;
    branchName: string;
  };
  fileChanges: {
    additions: {
      path: string;
      contents: string;
    }[];
    deletions: {
      path: string;
    }[];
  };
  expectedHeadOid: string;
  message: {
    headline: string;
    body: string;
  };
}

interface CreateCommitOutput {
  data: {
    createCommitOnBranch: {
      // A unique identifier for the client performing the mutation.
      clientMutationId: string;

      commit: {
        // The Git commit object ID
        oid: string;

        // The HTTP URL for this Git object
        url: string;
      };
    };
  };

  errors?: GraphQLError[];
}

async function createCommit(
  client: http.HttpClient,
  options: FuzzOptions,
  input: CreateCommitInput
): Promise<CreateCommitOutput> {
  const query = {
    // https://docs.github.com/en/graphql/reference/mutations#createcommitonbranch
    query: `mutation ($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) {
        commit {
          oid
          url
        }
      }
    }`,
    variables: {
      input,
    },
  };
  core.debug(`create a commit request: ${JSON.stringify(query)}`);

  const response = await client.postJson<CreateCommitOutput>(options.githubGraphqlUrl, query);
  core.debug(`create a commit response: ${JSON.stringify(response)}`);
  if (response.result == null) {
    throw new Error("failed to create a commit");
  }
  if (response.result.errors != null) {
    for (const error of response.result.errors) {
      core.error(`failed to create a commit: ${error.message}`);
    }
    core.error(
      "please check whether the GitHub token has the write permission to the repository. " +
        "see https://github.com/shogo82148/actions-go-fuzz#permissions for more details."
    );
    throw new Error("failed to create a commit");
  }
  return response.result;
}

interface CreatePullRequestInput {
  baseRefName: string;
  body: string;
  clientMutationId: string;
  draft: boolean;
  headRefName: string;
  headRepositoryId: string;
  maintainerCanModify: boolean;
  repositoryId: string;
  title: string;
}

interface CreatePullRequestOutput {
  data: {
    createPullRequest: {
      // A unique identifier for the client performing the mutation.
      clientMutationId: string;

      // The new pull request.
      // https://docs.github.com/en/graphql/reference/objects#pullrequest
      pullRequest: {
        // Identifies the pull request number.
        number: number;

        // The HTTP URL for this Git object
        url: string;
      };
    };
  };

  errors?: GraphQLError[];
}

async function createPullRequest(
  client: http.HttpClient,
  options: FuzzOptions,
  input: CreatePullRequestInput
): Promise<CreatePullRequestOutput> {
  const query = {
    // https://docs.github.com/en/graphql/reference/mutations#createpullrequest
    query: `mutation ($input: CreatePullRequestInput!) {
      createPullRequest(input: $input) {
        pullRequest {
          number
          url
        }
      }
    }`,
    variables: {
      input,
    },
  };
  core.debug(`create a pull request request: ${JSON.stringify(query)}`);

  const response = await client.postJson<CreatePullRequestOutput>(options.githubGraphqlUrl, query);
  core.debug(`create a pull request response: ${JSON.stringify(response)}`);
  if (response.result == null) {
    throw new Error("failed to create a pull request");
  }
  if (response.result.errors != null) {
    for (const error of response.result.errors) {
      core.error(`failed to create a pull request: ${error.message}`);
    }
    core.error(
      "please check whether the GitHub token has the write permission to the repository. " +
        "see https://github.com/shogo82148/actions-go-fuzz#permissions for more details."
    );
    throw new Error("failed to create a pull request");
  }
  return response.result;
}

async function sendReportViaSlack(options: FuzzOptions, report: GenerateReportResult): Promise<FuzzResult> {
  const logUrl =
    options.githubRunId != null && options.githubRunAttempt != null
      ? `${options.githubServerUrl}/${options.repository}/actions/runs/${options.githubRunId}/attempts/${options.githubRunAttempt}`
      : undefined;

  const client = new http.HttpClient("shogo82148/actions-go-fuzz");
  await client.postJson(options.webhookUrl, {
    text: `<${options.githubServerUrl}/${options.repository}|${options.repository}>: ${report.testFunc} in the package ${report.packageName} failed.`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${options.githubServerUrl}/${options.repository}|${options.repository}>: *${report.testFunc}* in the package *${report.packageName}* failed.`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${"`"}${report.testCommand}${"`"} failed with the following output:
${"```"}
${report.testResult}
${"```"}

The following patch can reproduce the crash:

${"```"}
${report.patch}
${"```"}
`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `reported by <https://github.com/shogo82148/actions-go-fuzz|actions-go-fuzz>.${
              logUrl != null ? ` <${logUrl}|See the log>.` : ""
            }`,
          },
        ],
      },
    ],
  });

  return {
    found: true,
  };
}
