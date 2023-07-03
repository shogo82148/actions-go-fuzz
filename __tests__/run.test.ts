import path from "path";
import { test, jest, expect } from "@jest/globals";
import { HttpClient } from "@actions/http-client";
import { fuzz } from "../src/run-impl";

test("no error", async () => {
  const mockClient = jest.spyOn(HttpClient.prototype, "postJson");
  mockClient.mockRejectedValue(new Error("unexpected call"));

  const workingDirectory = path.join(__dirname, "testdata/fuzz");
  const opts = {
    repository: "shogo82148/actions-go-fuzz",
    githubToken: "dummy",
    githubGraphqlUrl: "https://api.github.com/graphql",
    githubServerUrl: "https://github.com",
    githubRunId: "123456789",
    githubRunAttempt: "1",
    baseBranch: "main",
    packages: "example/fuzz/sub",
    fuzzRegexp: "^FuzzSomeFuzzTarget$",
    fuzzTime: "5s",
    fuzzMinimizeTime: "1s",
    workingDirectory,
    headBranchPrefix: "actions-go-fuzz",
  };
  const result = await fuzz(opts);
  expect(result).toEqual({ found: false });
}, 600000); // it runs go test, so it takes time.

test("found fuzz", async () => {
  const mockClient = jest.spyOn(HttpClient.prototype, "postJson");

  // return repository id
  mockClient.mockImplementationOnce(async (_url: string, _query: any) => {
    return {
      statusCode: 200,
      result: { data: { repository: { id: "R_kgDOJzylxw" } } },
      headers: {},
    };
  });

  // result of creating a branch
  mockClient.mockImplementationOnce(async (_url: string, query: any) => {
    expect(query.variables.input.repositoryId).toEqual("R_kgDOJzylxw");
    return {
      statusCode: 200,
      result: {
        clientMutationId: "1a768471-4725-4024-ba8e-339dd3f33dce",
      },
      headers: {},
    };
  });

  // result of creating a new commit.
  mockClient.mockImplementationOnce(async (_url: string, query: any) => {
    expect(query.variables.input.branch.repositoryNameWithOwner).toEqual("shogo82148/actions-go-fuzz");
    expect(query.variables.input.branch.branchName).toMatch(/^actions-go-fuzz\/example\/fuzz\/FuzzReverse/);
    return {
      statusCode: 200,
      result: {
        data: {
          clientMutationId: "1a768471-4725-4024-ba8e-339dd3f33dce",
          createCommitOnBranch: {
            commit: {
              oid: "c1d01d6c281fc1f24ca2368de0bced4ba72b24ea",
            },
          },
        },
      },
      headers: {},
    };
  });

  // result of creating a new pull request.
  mockClient.mockImplementationOnce(async (_url: string, query: any) => {
    expect(query.variables.input.repositoryId).toEqual("R_kgDOJzylxw");
    expect(query.variables.input.headRepositoryId).toEqual("R_kgDOJzylxw");
    return {
      statusCode: 200,
      result: {
        data: {
          clientMutationId: "1a768471-4725-4024-ba8e-339dd3f33dce",
          createPullRequest: {
            pullRequest: {
              number: 1,
              url: "https://github.com/shogo82148/actions-go-fuzz/pull/1",
            },
          },
        },
      },
      headers: {},
    };
  });

  const workingDirectory = path.join(__dirname, "testdata/fuzz");
  const opts = {
    repository: "shogo82148/actions-go-fuzz",
    githubToken: "dummy",
    githubGraphqlUrl: "https://api.github.com/graphql",
    githubServerUrl: "https://github.com",
    githubRunId: "123456789",
    githubRunAttempt: "1",
    baseBranch: "main",
    packages: "example/fuzz",
    fuzzRegexp: "^FuzzReverse$",
    fuzzTime: "30s",
    fuzzMinimizeTime: "1s",
    workingDirectory,
    headBranchPrefix: "actions-go-fuzz",
  };
  const result = await fuzz(opts);
  expect(result.headBranch).toMatch(/^actions-go-fuzz\/example\/fuzz\/FuzzReverse/);
  expect(result.pullRequestNumber).toEqual(1);
  expect(result.pullRequestUrl).toEqual("https://github.com/shogo82148/actions-go-fuzz/pull/1");
}, 600000); // it runs go test, so it takes time.

test("permission error during creating a branch", async () => {
  const mockClient = jest.spyOn(HttpClient.prototype, "postJson");

  // return repository id
  mockClient.mockImplementationOnce(async (_url: string, _query: any) => {
    return {
      statusCode: 200,
      result: { data: { repository: { id: "R_kgDOJzylxw" } } },
      headers: {},
    };
  });

  // result of creating a branch
  mockClient.mockImplementationOnce(async (_url: string, query: any) => {
    expect(query.variables.input.repositoryId).toEqual("R_kgDOJzylxw");
    return {
      statusCode: 200,
      result: {
        data: {
          createRef: null,
        },
        errors: [
          {
            type: "FORBIDDEN",
            path: ["createRef"],
            extensions: {
              saml_failure: false,
            },
            locations: [
              {
                line: 2,
                column: 7,
              },
            ],
            message: "Resource not accessible by integration",
          },
        ],
      },
      headers: {},
    };
  });

  const workingDirectory = path.join(__dirname, "testdata/fuzz");
  const opts = {
    repository: "shogo82148/actions-go-fuzz",
    githubToken: "dummy",
    githubGraphqlUrl: "https://api.github.com/graphql",
    githubServerUrl: "https://github.com",
    githubRunId: "123456789",
    githubRunAttempt: "1",
    baseBranch: "main",
    packages: "example/fuzz",
    fuzzRegexp: "^FuzzReverse$",
    fuzzTime: "30s",
    fuzzMinimizeTime: "1s",
    workingDirectory,
    headBranchPrefix: "actions-go-fuzz",
  };
  await expect(fuzz(opts)).rejects.toThrowError("failed to create a branch");
}, 600000); // it runs go test, so it takes time.

test("suppress the error if the branch already exists", async () => {
  const mockClient = jest.spyOn(HttpClient.prototype, "postJson");

  // return repository id
  mockClient.mockImplementationOnce(async (_url: string, _query: any) => {
    return {
      statusCode: 200,
      result: { data: { repository: { id: "R_kgDOJzylxw" } } },
      headers: {},
    };
  });

  // result of creating a branch
  mockClient.mockImplementationOnce(async (_url: string, query: any) => {
    expect(query.variables.input.repositoryId).toEqual("R_kgDOJzylxw");
    return {
      statusCode: 200,
      result: {
        data: {
          createRef: null,
        },
        errors: [
          {
            type: "UNPROCESSABLE",
            path: ["createRef"],
            extensions: {
              saml_failure: false,
            },
            locations: [
              {
                line: 2,
                column: 7,
              },
            ],
            message: 'A ref named "refs/heads/main" already exists in the repository.',
          },
        ],
      },
      headers: {},
    };
  });

  const workingDirectory = path.join(__dirname, "testdata/fuzz");
  const opts = {
    repository: "shogo82148/actions-go-fuzz",
    githubToken: "dummy",
    githubGraphqlUrl: "https://api.github.com/graphql",
    githubServerUrl: "https://github.com",
    githubRunId: "123456789",
    githubRunAttempt: "1",
    baseBranch: "main",
    packages: "example/fuzz",
    fuzzRegexp: "^FuzzReverse$",
    fuzzTime: "30s",
    fuzzMinimizeTime: "1s",
    workingDirectory,
    headBranchPrefix: "actions-go-fuzz",
  };
  const result = await fuzz(opts);
  expect(result).toEqual({ found: false });
}, 600000); // it runs go test, so it takes time.
