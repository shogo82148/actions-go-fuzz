import path from "path";
import { test, jest } from "@jest/globals";
import { HttpClient } from "@actions/http-client";
import { fuzz } from "../src/run-impl";
import { IncomingHttpHeaders } from "http";
import { TypedResponse } from "@actions/http-client/lib/interfaces";

test("no error", async () => {
  const mockClient = jest.spyOn(HttpClient.prototype, "postJson");
  mockClient.mockRejectedValue(new Error("unexpected call"));

  const workingDirectory = path.join(__dirname, "testdata/fuzz");
  const opts = {
    repository: "shogo82148/actions-go-fuzz",
    githubToken: "dummy",
    githubGraphqlUrl: "https://api.github.com/graphql",
    packages: "example/fuzz/sub",
    fuzzRegexp: "^FuzzSomeFuzzTarget$",
    fuzzTime: "5s",
    fuzzMinimizeTime: "1s",
    workingDirectory,
    headBranchPrefix: "actions-go-fuzz/",
  };
  await fuzz(opts);
}, 30000); // it runs go test, so it takes time.

test("found fuzz", async () => {
  const mockClient = jest.spyOn(HttpClient.prototype, "postJson");

  // return repository id
  mockClient.mockReturnValueOnce(
    new Promise<TypedResponse<any>>((resolve) =>
      resolve({
        statusCode: 200,
        result: { data: { repository: { object: { oid: "R_kgDOJzylxw" } } } },
        headers: {} as IncomingHttpHeaders,
      })
    )
  );

  // result of creating a branch
  mockClient.mockReturnValueOnce(
    new Promise<TypedResponse<any>>((resolve) =>
      resolve({
        statusCode: 200,
        result: {
          /* TODO: fill me! */
        },
        headers: {} as IncomingHttpHeaders,
      })
    )
  );

  const workingDirectory = path.join(__dirname, "testdata/fuzz");
  const opts = {
    repository: "shogo82148/actions-go-fuzz",
    githubToken: "dummy",
    githubGraphqlUrl: "https://api.github.com/graphql",
    packages: "example/fuzz",
    fuzzRegexp: "^FuzzReverse$",
    fuzzTime: "30s",
    fuzzMinimizeTime: "1s",
    workingDirectory,
    headBranchPrefix: "actions-go-fuzz/",
  };
  await fuzz(opts);
}, 30000); // it runs go test, so it takes time.
