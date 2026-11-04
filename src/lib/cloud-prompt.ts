import { generateSystemPrompt, type LibrarySpec, type PromptOptions } from "@openuidev/lang-core";
import { readFileSync } from "fs";
import { join } from "path";

/** Assemble the generated library and classroom rules into the local model prompt. */
export function cloudInstructions(extra?: string): string {
  const { promptOptions, ...library } = JSON.parse(
    readFileSync(join(process.cwd(), "src/generated/spec.json"), "utf-8"),
  ) as LibrarySpec & { promptOptions?: PromptOptions };
  return generateSystemPrompt({
    cloud: false,
    library,
    promptOptions: extra
      ? { ...promptOptions, additionalRules: [...(promptOptions?.additionalRules ?? []), extra] }
      : promptOptions,
  });
}
