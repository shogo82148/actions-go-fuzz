// See: https://rollupjs.org/introduction/

import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";

const makeConfig = (input, output) => {
  return {
    input,
    output: {
      esModule: true,
      file: output,
      format: "es",
      sourcemap: true,
    },
    plugins: [typescript(), nodeResolve({ preferBuiltins: true }), commonjs(), json()],
  };
};

export default [
  makeConfig("src/list.ts", "dist/list.js"),
  makeConfig("src/run.ts", "dist/run.js"),
  makeConfig("src/save-cache.ts", "dist/save-cache.js"),
];
