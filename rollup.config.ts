// See: https://rollupjs.org/introduction/

import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

function makeConfig(input: string, output: string) {
  return {
    input,
    output: {
      esModule: true,
      file: output,
      format: "es" as const,
      sourcemap: true,
    },
    plugins: [
      // Disable declaration file generation: rollup bundles everything into a
      // single output file, so emitting .d.ts files alongside it would produce
      // incorrect relative paths and is not needed for a bundled action.
      typescript({ declaration: false, declarationMap: false }),
      nodeResolve({ preferBuiltins: true, extensions: [".ts", ".js"] }),
      commonjs(),
      json(),
    ],
  };
}

export default [
  makeConfig("src/list.ts", "dist/list/index.js"),
  makeConfig("src/run.ts", "dist/run/index.js"),
  makeConfig("src/save-cache.ts", "dist/save-cache/index.js"),
];
