import test from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import {
  ClaudeCliError,
  LIBRARY_CONNECTIONS_MODEL,
  forcedTokenEnv,
  runClaude,
  withPinnedConnectionsModel,
} from "./connections";

// The headless `claude` subprocess (scheduled reweave + editor-pass) must authenticate with the
// long-lived CLAUDE_CODE_OAUTH_TOKEN, NOT the macOS Keychain — which Claude prefers but can't refresh in
// a launchd context, so every scheduled call 401s. forcedTokenEnv strips the env to force the token.

test("forcedTokenEnv returns undefined when no OAuth token is set (interactive — keep full env + Keychain)", () => {
  const original = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    assert.equal(forcedTokenEnv(), undefined);
  } finally {
    if (original === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = original;
  }
});

test("forcedTokenEnv strips to a minimal allowlist (token forced, Keychain unreachable) when the token is set", () => {
  const original = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const originalSecret = process.env.SOME_UNRELATED_SECRET;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-test";
  process.env.SOME_UNRELATED_SECRET = "should-not-pass-through";
  try {
    const env = forcedTokenEnv();
    assert.ok(env, "expected a stripped env object");
    assert.equal(env!.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-test");
    assert.ok(env!.PATH, "PATH must survive so claude/ripgrep resolve");
    assert.ok("HOME" in env!, "HOME must survive for ~/.claude config");
    // Arbitrary env (and anything that could re-enable Keychain) must NOT pass through.
    assert.equal(env!.SOME_UNRELATED_SECRET, undefined);
  } finally {
    if (original === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = original;
    if (originalSecret === undefined) delete process.env.SOME_UNRELATED_SECRET;
    else process.env.SOME_UNRELATED_SECRET = originalSecret;
  }
});

test("Connections and reweave calls are always pinned to Claude Sonnet 4.6", () => {
  const original = process.env.LIBRARY_CONNECTIONS_MODEL;
  process.env.LIBRARY_CONNECTIONS_MODEL = "some-other-model";
  try {
    assert.equal(LIBRARY_CONNECTIONS_MODEL, "claude-sonnet-4-6");
    assert.deepEqual(withPinnedConnectionsModel(["-p", "task"]), [
      "-p",
      "task",
      "--model",
      "claude-sonnet-4-6",
    ]);
  } finally {
    if (original === undefined) delete process.env.LIBRARY_CONNECTIONS_MODEL;
    else process.env.LIBRARY_CONNECTIONS_MODEL = original;
  }
});

test("Claude print tasks travel over stdin instead of process arguments", async () => {
  const secret = "CURRENT WORK: private launch decision";
  const script = [
    'let input = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (chunk) => { input += chunk; });',
    'process.stdin.on("end", () => process.stdout.write(JSON.stringify({ args: process.argv.slice(1), input })));',
  ].join("");
  const stdout = await runClaude(process.execPath, ["-e", script, "--", "-p", secret, "--output-format", "json"], 5_000);
  const result = JSON.parse(stdout) as { args: string[]; input: string };

  assert.equal(result.input, secret);
  assert.equal(result.args.includes("-p"), true);
  assert.equal(result.args.includes(secret), false);
});

test("Claude subprocess failures are safe to log while retaining hidden diagnostic streams", async () => {
  const secret = "CURRENT WORK: do not log this packet";
  const script = [
    'let input = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (chunk) => { input += chunk; });',
    'process.stdin.on("end", () => { process.stderr.write("rate limit 429"); process.exit(7); });',
  ].join("");

  await assert.rejects(
    runClaude(process.execPath, ["-e", script, "--", "-p", secret], 5_000),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeCliError);
      assert.match(error.message, /Claude CLI failed \(exit 7\)/);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.stack?.includes(secret), false);
      assert.equal(error.stderr, "rate limit 429");
      assert.equal(JSON.stringify(error).includes(secret), false);
      assert.equal(inspect(error).includes(secret), false);
      assert.equal(Object.keys(error).includes("stderr"), false);
      return true;
    },
  );
});
