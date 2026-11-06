declare module "eslint-scope" {
  import type { Program } from "acorn";
  export function analyze(program: Program, options: { ecmaVersion: number; sourceType: "script" }): {
    globalScope: {
      variables: { name: string }[];
      through: { identifier: { name: string; start: number; end: number } }[];
    };
  };
}
