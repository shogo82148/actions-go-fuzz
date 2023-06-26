import path from "path";
import { list } from "../src/list-impl";
import { expect, test } from "@jest/globals";

test("throws invalid number", async () => {
  const workingDirectory = path.join(__dirname, "testdata/fuzz");
  const { fuzzTests } = await list(["./..."], workingDirectory);
  expect(fuzzTests).toEqual([
    {
      package: "example/fuzz",
      func: "FuzzReverse",
    },
    {
      package: "example/fuzz/sub",
      func: "FuzzSomeFuzzTarget",
    },
  ]);
});
