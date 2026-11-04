# Rich AI Chat: from interactive answers to student projects

The calculator is the first acceptance example. Number keys, operators, equals, and clear should update the calculator immediately. No calculator key should add a chat message or call the model. A separate “Explain this calculation” action can send a message on purpose.

## Phase 1: Play inside chat

The prototype uses the OpenUI HTML Artifact pattern: the model emits self-contained HTML, CSS, and JavaScript, and the student chooses Run preview or View source. The preview does not share an origin with chat, has no external resource access, and does not send model requests when its controls are used. Stopping the preview discards runtime state; the generated source stays in the conversation.

The calculator and tic-tac-toe are acceptance examples, not fixed templates. If a smaller model struggles with arbitrary code, offer vetted components as an optional fallback. The iframe does not guarantee CPU or memory limits, so this preview is intended for supervised local use. Do not expose file or GitHub credentials to the preview.

Acceptance: calculator operations and a full game work with model requests blocked after generation. Check parent document isolation and blocked external requests in the browser. Compare DeepSeek Flash and the local 4B model using the same prompts.

## Phase 2: Edit project files

“Save as project” copies an artifact into a new, isolated project workspace with its own file tree and preview. Add a small tool set: list files, read a file, propose a patch, and run a vetted check. Let the app show a diff and apply approved patches. Resolve paths under the workspace root, reject path traversal and symlink escapes, and enforce file and patch limits. Exclude secrets and prohibit arbitrary shell access in the initial version. If checks require executing generated code, run them outside the chat server with explicit resource and network limits. Reuse the PLH policy boundary described in STEP-2.md.

Acceptance: create a project from a game, change a rule through chat, inspect the diff, and reopen the updated preview. A patch targeting another workspace or a secret file is rejected.

## Phase 3: Open GitHub pull requests

Connect an account through a GitHub App installed on selected repositories. After the user chooses a repository, show the target branch, proposed diff, and check results. On explicit approval, publish to a separate branch and open a draft PR. Keep credentials on the server, limit permissions to the selected repository, and keep pushing to the default branch and merging out of the model tool set.

Acceptance: review a proposed project change and open a draft PR in a test repository; no remote writes happen before approval, and retrying does not create a duplicate PR.
