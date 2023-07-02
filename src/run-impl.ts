import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as http from "@actions/http-client";
import * as cache from "@actions/cache";
import * as crypto from "crypto";
import fs from "fs/promises";

export const ReportMethod = {
  PullRequest: "pull-request",
  SecurityVulnerability: "security-vulnerability",
} as const;

export type ReportMethodType = (typeof ReportMethod)[keyof typeof ReportMethod];

interface FuzzOptions {
  repository: string;
  githubToken: string;
  githubApiUrl: string;
  githubGraphqlUrl: string;
  githubServerUrl: string;
  githubRunId: string | undefined;
  githubRunAttempt: string | undefined;
  baseBranch: string;
  packages: string;
  workingDirectory: string;
  fuzzRegexp: string;
  fuzzTime: string;
  reportMethod: ReportMethodType;
  fuzzMinimizeTime: string;
  headBranchPrefix: string;
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
    core.info("no fuzzing error");
    return {
      found: false,
    };
  }

  core.info("fuzzing error occurred");
  const result = await core.group("generate report", async () => {
    return await generateReport(options);
  });
  if (result == null) {
    core.info("no new corpus found");
    return {
      found: false,
    };
  }

  return {
    found: true,
    headBranch: result.headBranch,
    pullRequestNumber: result.pullRequestNumber,
    pullRequestUrl: result.pullRequestUrl,
  };
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
  headBranch: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
}

async function generateReport(options: FuzzOptions): Promise<GenerateReportResult | null> {
  // const cwd = { cwd: options.workingDirectory };
  const ignoreReturnCode = { cwd: options.workingDirectory, ignoreReturnCode: true };

  const corpus = await getNewCorpus(options);
  if (corpus == null) {
    return null;
  }
  core.info(`new corpus found: ${corpus}`);

  const client = new http.HttpClient("shogo82148/actions-go-fuzz", [], {
    headers: {
      Authorization: `Bearer ${options.githubToken}`,
      "X-Github-Next-Global-ID": "1",
    },
  });
  const repositoryId = await getRepositoryId(client, options);
  core.debug(`repositoryId: ${repositoryId}`);

  // create a new branch
  const packageName = await getPackageName(options);
  const segments = corpus.split("/");
  const testFunc = segments[segments.length - 2];
  const testCorpus = segments[segments.length - 1];
  const branchName = `${options.headBranchPrefix}/${packageName}/${testFunc}/${testCorpus}`;
  const oid = await getHeadRef();
  await createBranch(client, options, {
    clientMutationId: newClientMutationId(),
    repositoryId,
    name: `refs/heads/${branchName}`,
    oid,
  });

  const testResult = await exec.getExecOutput(
    "go",
    ["test", `-run=${testFunc}/${testCorpus}`, options.packages],
    ignoreReturnCode
  );

  const contents = await fs.readFile(corpus);

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
          path: corpus,
          contents: contents.toString("base64"),
        },
      ],
      deletions: [],
    },
    expectedHeadOid: oid,
    message: {
      headline: `Add a new fuzz input data for ${testFunc} in ${packageName}.`,
      body: `${"`"}go test -run=${testFunc}/${testCorpus} ${options.packages}${"`"} failed with the following output:

${"```"}
${testResult.stdout}
${"```"}

This fuzz data is generated by [actions-go-fuzz](https://github.com/shogo82148/actions-go-fuzz).
`,
    },
  });

  const logUrl =
    options.githubRunId != null && options.githubRunAttempt != null
      ? `${options.githubServerUrl}/${options.repository}/actions/runs/${options.githubRunId}/attempts/${options.githubRunAttempt}`
      : undefined;

  await reportSecurityVulnerability(client, options, {
    summary: `${testFunc} in the package ${packageName} failed`,
    description: `${"`"}go test -run=${testFunc}/${testCorpus} ${
      options.packages
    }${"`"} failed with the following output:

  ${"```"}
  ${testResult.stdout}
  ${"```"}
  
  ---
  
  This report is generated by [actions-go-fuzz](https://github.com/shogo82148/actions-go-fuzz).
  ${logUrl != null ? `\n[See the log](${logUrl}).` : ""}
    `,
    vulnerabilities: null,
    cwe_ids: null,
    severity: null,
  });

  // create a new pull request
  const pullRequest = await createPullRequest(client, options, {
    clientMutationId: newClientMutationId(),
    repositoryId,
    headRepositoryId: repositoryId,
    baseRefName: options.baseBranch,
    headRefName: branchName,
    maintainerCanModify: true,
    draft: false,
    title: `${testFunc} in the package ${packageName} failed`,
    body: `${"`"}go test -run=${testFunc}/${testCorpus} ${options.packages}${"`"} failed with the following output:

${"```"}
${testResult.stdout}
${"```"}

---

This pull request is generated by [actions-go-fuzz](https://github.com/shogo82148/actions-go-fuzz).
${logUrl != null ? `\n[See the log](${logUrl}).` : ""}
`,
  });

  // cleanup
  await exec.exec("git", ["restore", "--staged", "."], ignoreReturnCode);
  await fs.unlink(corpus);

  return {
    headBranch: branchName,
    pullRequestNumber: pullRequest.data.createPullRequest.pullRequest.number,
    pullRequestUrl: pullRequest.data.createPullRequest.pullRequest.url,
  };
}

async function getNewCorpus(options: FuzzOptions): Promise<string | undefined> {
  const cwd = { cwd: options.workingDirectory };
  const ignoreReturnCode = { cwd: options.workingDirectory, ignoreReturnCode: true };

  // check whether there is any changes.
  await exec.exec("git", ["add", "."], cwd);
  const hasChange = await exec.exec("git", ["diff", "--cached", "--exit-code", "--quiet"], ignoreReturnCode);
  if (hasChange === 0) {
    return undefined;
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
    return undefined;
  }
  return testdata[0];
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

interface ReportSecurityVulnerabilityInput {
  summary: string;
  description: string;
  vulnerabilities:
    | [
        {
          package: {
            ecosystem: string;
            name: string;
          };
        }
      ]
    | null;
  cwe_ids: string[] | null;
  severity: "critical" | "high" | "medium" | "low" | null;
}

async function reportSecurityVulnerability(
  client: http.HttpClient,
  options: FuzzOptions,
  input: ReportSecurityVulnerabilityInput
): Promise<void> {
  const response = await client.postJson(
    `${options.githubApiUrl}/repos/${options.repository}/security-advisories/reports`,
    input
  );
  core.debug(`reportSecurityVulnerability: ${JSON.stringify(response)}`);
  return;
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

async function createBranch(
  client: http.HttpClient,
  options: FuzzOptions,
  input: CreateBranchInput
): Promise<CreateBranchOutput> {
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
      core.error(error.message);
    }
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
      core.error(error.message);
    }
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
      core.error(error.message);
    }
    throw new Error("failed to create a pull request");
  }
  return response.result;
}
