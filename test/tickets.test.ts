/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import {
  buildTicketChannelName,
  buildTicketCloseCustomId,
  buildTicketModalResponse,
  buildTicketOpenCustomId,
  extractTicketAnswersFromModal,
  parseTicketCustomId,
  renderTicketTranscript,
} from "../src/tickets";

test("buildTicketModalResponse uses modal questions and Discord text input rows", () => {
  const response = buildTicketModalResponse({
    id: "appeals",
    label: "Appeal",
    emoji: "🧾",
    buttonStyle: "primary",
    supportRoleId: "role-1",
    channelNamePrefix: "appeal",
    questions: [
      {
        id: "reason",
        label: "Why are you opening this ticket?",
        style: "paragraph",
        placeholder: "Explain the issue",
        required: true,
      },
    ],
  });

  assert.equal(response.type, 9);
  assert.equal(response.data.custom_id, buildTicketOpenCustomId("appeals"));
  assert.equal(response.data.title, "Appeal");
  assert.equal(response.data.components[0].components[0].custom_id, "reason");
  assert.equal(response.data.components[0].components[0].label, "Why are you opening this ticket?");
  assert.equal(response.data.components[0].components[0].placeholder, "Explain the issue");
  assert.equal(response.data.components[0].components[0].required, true);
});

test("parseTicketCustomId parses open and close custom IDs", () => {
  assert.deepEqual(parseTicketCustomId(buildTicketOpenCustomId("appeals")), {
    action: "open",
    ticketTypeId: "appeals",
  });

  assert.deepEqual(parseTicketCustomId(buildTicketCloseCustomId("channel-1")), {
    action: "close",
    channelId: "channel-1",
  });
});

test("buildTicketChannelName prefixes the opener user id", () => {
  assert.equal(buildTicketChannelName("appeal", "user-1"), "appeal-user-1");
});

test("extractTicketAnswersFromModal reads submitted modal fields", () => {
  const answers = extractTicketAnswersFromModal(
    {
      data: {
        components: [
          {
            components: [{ custom_id: "reason", value: "I need help" }],
          },
          {
            components: [{ custom_id: "details", value: "More details" }],
          },
        ],
      },
    },
    [
      {
        id: "reason",
        label: "Reason",
        style: "paragraph",
        placeholder: null,
        required: true,
      },
      {
        id: "details",
        label: "Details",
        style: "short",
        placeholder: null,
        required: false,
      },
    ]
  );

  assert.deepEqual(answers, [
    { questionId: "reason", label: "Reason", value: "I need help" },
    { questionId: "details", label: "Details", value: "More details" },
  ]);
});

test("renderTicketTranscript includes ticket metadata, answers, and chronological messages", () => {
  const transcript = renderTicketTranscript(
    {
      guildId: "guild-1",
      channelId: "channel-1",
      ticketTypeId: "appeals",
      ticketTypeLabel: "Appeal",
      openerUserId: "user-1",
      supportRoleId: "role-1",
      status: "closed",
      answers: [
        { questionId: "reason", label: "Reason", value: "I need help" },
      ],
      openedAtMs: 1_700_000_000_000,
      closedAtMs: 1_700_000_001_000,
      closedByUserId: "staff-1",
      transcriptMessageId: "msg-1",
    },
    [
      {
        authorId: "staff-1",
        authorTag: "Support#0002",
        content: "First reply",
        createdAtMs: 1_700_000_000_400,
      },
      {
        authorId: "user-1",
        authorTag: "User#0001",
        content: "Hello",
        createdAtMs: 1_700_000_000_500,
      },
    ]
  );

  assert.match(transcript, /Guild: guild-1/);
  assert.match(transcript, /Ticket Type: Appeal \(appeals\)/);
  assert.match(transcript, /Opened by: user-1/);
  assert.match(transcript, /Opened at: /);
  assert.match(transcript, /Closed at: /);
  assert.match(transcript, /Closed by: staff-1/);
  assert.match(transcript, /Reason: I need help/);
  assert.match(transcript, /Support#0002: First reply/);
  assert.match(transcript, /User#0001: Hello/);
  assert.ok(transcript.indexOf("Support#0002: First reply") < transcript.indexOf("User#0001: Hello"));
});
