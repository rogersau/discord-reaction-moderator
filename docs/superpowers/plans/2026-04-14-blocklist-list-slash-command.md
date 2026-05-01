# Blocklist List Slash Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/blocklist list` slash command that shows the current server's blocked emojis in an ephemeral response.

**Architecture:** Extend the existing `blocklist` command family so `add`, `remove`, and `list` share the same permission gate and guild-scoped routing. Keep command parsing in `src/discord-interactions.ts`, command definitions in `src/discord-commands.ts`, and response handling in `src/index.ts` so the new subcommand stays small and testable.

**Tech Stack:** TypeScript, Cloudflare Workers, SQLite-backed Durable Objects, Discord interactions API, Node test runner, Wrangler

---

### Task 1: Extend command parsing for the new subcommand

**Files:**

- Modify: `src/discord-commands.ts`
- Modify: `src/discord-interactions.ts`
- Test: `test/discord-interactions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("SLASH_COMMAND_DEFINITIONS includes the blocklist list subcommand", () => {
  assert.deepEqual(
    SLASH_COMMAND_DEFINITIONS[0].options?.map((option) => option.name),
    ["add", "remove", "list"],
  );
});

test("extractCommandInvocation returns a list invocation without an emoji", () => {
  const interaction = {
    data: {
      name: "blocklist",
      options: [
        {
          name: "list",
          type: 1,
        },
      ],
    },
  };

  assert.deepEqual(extractCommandInvocation(interaction), {
    commandName: "blocklist",
    subcommandName: "list",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/discord-interactions.test.js`
Expected: FAIL because `list` is missing from the command tree and the parser still requires an emoji option.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/discord-commands.ts
export const SLASH_COMMAND_DEFINITIONS = [
  {
    name: "blocklist",
    description: "Manage this server's blocked emoji list",
    options: [
      {
        type: 1,
        name: "add",
        description: "Block an emoji in this server",
        options: [{ type: 3, name: "emoji", description: "Emoji to block", required: true }],
      },
      {
        type: 1,
        name: "remove",
        description: "Unblock an emoji in this server",
        options: [{ type: 3, name: "emoji", description: "Emoji to unblock", required: true }],
      },
      {
        type: 1,
        name: "list",
        description: "List the emojis blocked in this server",
      },
    ],
  },
];
```

```ts
// src/discord-interactions.ts
export function extractCommandInvocation(
  invocation: any,
):
  | { commandName: string; subcommandName: "list" }
  | { commandName: string; subcommandName: "add" | "remove"; emoji: string }
  | null {
  const data = invocation?.data;
  if (!data || typeof data.name !== "string") return null;

  const cmdDef = SLASH_COMMAND_DEFINITIONS.find((d) => d.name === data.name);
  if (!cmdDef) return null;

  const options = Array.isArray(data.options) ? data.options : [];
  const sub = options[0];
  if (!sub || sub.type !== 1) return null;

  const subDef = (cmdDef.options || []).find(
    (o: any) => o.name === sub.name && o.type === sub.type,
  );
  if (!subDef) return null;

  if (sub.name === "list") {
    return { commandName: data.name, subcommandName: "list" };
  }

  const emojiDef = (subDef.options || []).find((o: any) => o.name === "emoji" && o.type === 3);
  if (!emojiDef) return null;

  const emojiOpt = Array.isArray(sub.options)
    ? sub.options.find((o: any) => o.name === "emoji")
    : undefined;
  const emoji = emojiOpt?.value;
  if (typeof emoji !== "string") return null;

  return { commandName: data.name, subcommandName: sub.name, emoji };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/discord-interactions.test.js`
Expected: PASS for the command definition and parser tests.

- [ ] **Step 5: Commit**

```bash
git add src/discord-commands.ts src/discord-interactions.ts test/discord-interactions.test.ts
git commit -m "feat: add blocklist list command parsing"
```

### Task 2: Add list handling to the interaction route

**Files:**

- Modify: `src/index.ts`
- Test: `test/interaction-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("worker returns the current server blocklist for /blocklist list", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "list",
    }),
  );

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch(input, init) {
        storeCalls.push({
          input: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({
          emojis: [],
          guilds: {
            "guild-123": {
              enabled: true,
              emojis: ["✅", "🍎"],
            },
          },
          botUserId: "",
        });
      },
    }),
    {} as ExecutionContext,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await response.json(),
    buildEphemeralMessage("Blocked emojis in this server:\n- ✅\n- 🍎"),
  );
  assert.deepEqual(storeCalls, [
    {
      input: "https://moderation-store/config",
      method: "GET",
      body: null,
    },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/interaction-routes.test.js --test-name-pattern="worker returns the current server blocklist for /blocklist list"`
Expected: FAIL because `/blocklist list` is not handled yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/index.ts
if (invocation.subcommandName === "list") {
  try {
    const config = await getBlocklistFromStore(() =>
      storeStub.fetch("https://moderation-store/config"),
    );
    const guildEmojis = config.guilds?.[interaction.guild_id]?.emojis ?? [];
    const content =
      guildEmojis.length === 0
        ? "No emojis are blocked in this server."
        : `Blocked emojis in this server:\n${guildEmojis.map((emoji) => `- ${emoji}`).join("\n")}`;

    return Response.json(buildEphemeralMessage(content));
  } catch (error) {
    console.error("Failed to load moderation config", error);
    return Response.json(buildEphemeralMessage("Failed to load the server blocklist."));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/interaction-routes.test.js --test-name-pattern="worker returns the current server blocklist for /blocklist list"`
Expected: PASS and the response remains ephemeral.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/interaction-routes.test.ts
git commit -m "feat: add blocklist list interaction"
```

### Task 3: Document the new slash command

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update the slash command docs**

```md
- `/blocklist add emoji:<emoji>` — block an emoji in the current server
- `/blocklist remove emoji:<emoji>` — unblock an emoji in the current server
- `/blocklist list` — show the current server's blocked emojis
```

- [ ] **Step 2: Update any setup or command sync notes if needed**

```md
The scheduled bootstrap syncs `SLASH_COMMAND_DEFINITIONS`, so the new `list` subcommand will appear after the next successful bootstrap.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document blocklist list command"
```

### Task 4: Verify the full change

**Files:**

- None

- [ ] **Step 1: Run the full checks**

Run: `pnpm test && pnpm run typecheck && pnpm exec wrangler deploy --dry-run`
Expected: PASS for all tests, typecheck, and the Wrangler dry run.

- [ ] **Step 2: Review the final status message**

Confirm the worker now supports `/blocklist list` and the README matches the deployed behavior.
