/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { parseLfgPost } from "../src/durable-objects/community-store/request-parsers";

test("parseLfgPost accepts blank extra info for optional modal submissions", () => {
  const post = parseLfgPost({
    guildId: "guild-1",
    id: "post-1",
    ownerId: "owner-1",
    ownerDisplayName: "Owner",
    serverId: "namalsk",
    serverLabel: "Namalsk",
    whenPlay: "Evenings",
    lookingFor: "Duo",
    extraInfo: "",
    channelId: "channel-1",
    messageId: null,
    active: true,
    createdAtMs: 1,
    closedAtMs: null,
    closedByUserId: null,
  });

  assert.equal(post.extraInfo, "");
});