/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import {
  buildTicketTranscriptAttachmentPath,
  buildTicketTranscriptAttachmentStorageKey,
  buildTicketTranscriptPath,
  buildTicketChannelName,
  buildTicketCloseCustomId,
  buildTicketModalResponse,
  buildTicketOpenCustomId,
  buildTicketTranscriptStorageKey,
  buildTicketTranscriptSummaryEmbed,
  extractTicketAnswersFromModal,
  formatTicketNumber,
  parseTicketCustomId,
  renderTicketTranscriptHtml,
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

test("buildTicketChannelName prefixes and zero-pads ticket numbers", () => {
  assert.equal(buildTicketChannelName("Support", 1), "support-001");
  assert.equal(buildTicketChannelName("Appeals Team", 12), "appeals-team-012");
  assert.equal(buildTicketChannelName("***", 123), "ticket-123");
  assert.equal(formatTicketNumber(1000), "1000");
});

test("ticket transcript path helpers build stable public paths and storage keys", () => {
  assert.equal(buildTicketTranscriptStorageKey("guild-1", "channel-1"), "guild-1/channel-1.html");
  assert.equal(buildTicketTranscriptPath("guild-1", "channel-1"), "/transcripts/guild-1/channel-1");
  assert.equal(
    buildTicketTranscriptAttachmentStorageKey(
      "guild-1",
      "channel-1",
      "attachment-1",
      "proof image.png",
    ),
    "guild-1/channel-1/attachments/attachment-1/proof%20image.png",
  );
  assert.equal(
    buildTicketTranscriptAttachmentPath("guild-1", "channel-1", "attachment-1", "proof image.png"),
    "/transcripts/guild-1/channel-1/media/attachment-1/proof%20image.png",
  );
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
    ],
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
      answers: [{ questionId: "reason", label: "Reason", value: "I need help" }],
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
    ],
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
  assert.ok(
    transcript.indexOf("Support#0002: First reply") < transcript.indexOf("User#0001: Hello"),
  );
});

test("renderTicketTranscript includes attachment links below their messages", () => {
  const transcript = renderTicketTranscript(
    {
      guildId: "guild-1",
      channelId: "channel-1",
      ticketTypeId: "appeals",
      ticketTypeLabel: "Appeal",
      openerUserId: "user-1",
      supportRoleId: "role-1",
      status: "closed",
      answers: [],
      openedAtMs: 1_700_000_000_000,
      closedAtMs: 1_700_000_001_000,
      closedByUserId: "staff-1",
      transcriptMessageId: "msg-1",
    },
    [
      {
        authorId: "user-1",
        authorTag: "User#0001",
        content: "Here is the proof",
        createdAtMs: 1_700_000_000_500,
        attachments: [
          {
            id: "attachment-1",
            filename: "proof.png",
            url: "https://cdn.example/proof.png",
            proxyUrl: null,
            contentType: "image/png",
            size: 1536,
            width: 640,
            height: 480,
          },
          {
            id: "attachment-2",
            filename: "clip.mp4",
            url: "https://cdn.example/clip.mp4",
            proxyUrl: null,
            contentType: "video/mp4",
            size: 1_048_576,
            width: 1280,
            height: 720,
          },
        ],
      },
    ],
  );

  assert.match(transcript, /User#0001: Here is the proof/);
  assert.ok(
    transcript.includes("  Image: proof.png (image/png, 1.5 KB) - https://cdn.example/proof.png"),
  );
  assert.ok(
    transcript.includes("  Video: clip.mp4 (video/mp4, 1 MB) - https://cdn.example/clip.mp4"),
  );
});

test("renderTicketTranscriptHtml escapes content and includes transcript metadata", () => {
  const html = renderTicketTranscriptHtml(
    {
      guildId: "guild-1",
      channelId: "channel-1",
      ticketTypeId: "appeals",
      ticketTypeLabel: "Appeal",
      openerUserId: "user-1",
      supportRoleId: "role-1",
      status: "closed",
      answers: [{ questionId: "reason", label: "Reason", value: "Need <help> & support" }],
      openedAtMs: 1_700_000_000_000,
      closedAtMs: 1_700_000_001_000,
      closedByUserId: "staff-1",
      transcriptMessageId: "msg-1",
    },
    [
      {
        authorId: "user-1",
        authorTag: "User#0001",
        content: "Hello <script>alert('x')</script>",
        createdAtMs: 1_700_000_000_500,
      },
    ],
  );

  assert.match(html, /<title>Ticket Transcript channel-1<\/title>/);
  assert.match(html, /Ticket Type<\/dt><dd>Appeal \(appeals\)<\/dd>/);
  assert.match(html, /Need &lt;help&gt; &amp; support/);
  assert.match(html, /Hello &lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\('x'\)<\/script>/);
});

test("renderTicketTranscriptHtml renders image and video attachments inline", () => {
  const html = renderTicketTranscriptHtml(
    {
      guildId: "guild-1",
      channelId: "channel-1",
      ticketTypeId: "appeals",
      ticketTypeLabel: "Appeal",
      openerUserId: "user-1",
      supportRoleId: "role-1",
      status: "closed",
      answers: [],
      openedAtMs: 1_700_000_000_000,
      closedAtMs: 1_700_000_001_000,
      closedByUserId: "staff-1",
      transcriptMessageId: "msg-1",
    },
    [
      {
        authorId: "user-1",
        authorTag: "User#0001",
        content: "",
        createdAtMs: 1_700_000_000_500,
        attachments: [
          {
            id: "attachment-1",
            filename: "proof <image>.png",
            url: "https://cdn.example/proof.png?ex=1&is=2",
            proxyUrl: null,
            contentType: "image/png",
            size: 1536,
            width: 640,
            height: 480,
          },
          {
            id: "attachment-2",
            filename: "clip.mp4",
            url: "https://cdn.example/clip.mp4",
            proxyUrl: null,
            contentType: "video/mp4",
            size: 1_048_576,
            width: 1280,
            height: 720,
          },
          {
            id: "attachment-3",
            filename: "unsafe.png",
            url: "javascript:alert(1)",
            proxyUrl: null,
            contentType: "image/png",
            size: null,
            width: null,
            height: null,
          },
        ],
      },
    ],
  );

  assert.ok(
    html.includes(
      '<img src="https://cdn.example/proof.png?ex=1&amp;is=2" alt="proof &lt;image&gt;.png" loading="lazy" />',
    ),
  );
  assert.ok(
    html.includes(
      '<video controls preload="metadata"><source src="https://cdn.example/clip.mp4" type="video/mp4" /></video>',
    ),
  );
  assert.match(html, /Attachment URL unavailable/);
  assert.doesNotMatch(html, /javascript:alert/);
});

test("renderTicketTranscriptHtml prefers display names for opener and closer metadata", () => {
  const html = renderTicketTranscriptHtml(
    {
      guildId: "guild-1",
      channelId: "channel-1",
      ticketTypeId: "appeals",
      ticketTypeLabel: "Appeal",
      openerUserId: "user-1",
      supportRoleId: "role-1",
      status: "closed",
      answers: [],
      openedAtMs: 1_700_000_000_000,
      closedAtMs: 1_700_000_001_000,
      closedByUserId: "staff-1",
      transcriptMessageId: "msg-1",
    },
    [],
    {
      guildName: "Guild Name",
      channelName: "ticket-001",
      openerDisplayName: "Alice",
      closerDisplayName: "Support",
    },
  );

  assert.match(html, /Guild<\/dt><dd>Guild Name \(guild-1\)<\/dd>/);
  assert.match(html, /Channel<\/dt><dd>#ticket-001 \(channel-1\)<\/dd>/);
  assert.match(html, /Opened by<\/dt><dd>Alice \(user-1\)<\/dd>/);
  assert.match(html, /Closed by<\/dt><dd>Support \(staff-1\)<\/dd>/);
});

test("buildTicketTranscriptSummaryEmbed includes transcript overview and identifier search keys", () => {
  const embed = buildTicketTranscriptSummaryEmbed(
    {
      guildId: "guild-1",
      channelId: "channel-1",
      ticketTypeId: "appeals",
      ticketTypeLabel: "Appeal",
      openerUserId: "1493598719340318791",
      supportRoleId: "role-1",
      status: "closed",
      answers: [
        { questionId: "discord-id", label: "Discord ID", value: "1493598719340318791" },
        { questionId: "steam64", label: "Steam64", value: "76561198439127312" },
        { questionId: "in-game-name", label: "In-game name", value: "biubiu" },
      ],
      openedAtMs: 1_700_000_000_000,
      closedAtMs: 1_700_000_001_000,
      closedByUserId: "staff-1",
      transcriptMessageId: "msg-1",
    },
    [
      {
        authorId: "staff-1",
        authorTag: "Support",
        content: "Reply",
        createdAtMs: 1_700_000_000_500,
      },
      {
        authorId: "1493598719340318791",
        authorTag: "summertrain",
        content: "Help",
        createdAtMs: 1_700_000_000_400,
      },
    ],
    {
      guildName: "COLD AS FK",
      channelName: "ticket-0011",
      openerDisplayName: "summertrain",
      closerDisplayName: "Postal",
    },
  );

  assert.equal(embed.title, "Ticket Transcript");
  assert.equal(
    embed.fields?.find((field) => field.name === "Server")?.value,
    "COLD AS FK (guild-1)",
  );
  assert.equal(
    embed.fields?.find((field) => field.name === "Channel")?.value,
    "#ticket-0011 (channel-1)",
  );
  assert.equal(
    embed.fields?.find((field) => field.name === "Search keys")?.value,
    "discord:1493598719340318791 steam64:76561198439127312",
  );
  assert.equal(
    embed.fields?.find((field) => field.name === "Users in transcript")?.value,
    "1 - summertrain\n1 - Support",
  );
  assert.equal(
    embed.fields?.find((field) => field.name === "Ticket Owner")?.value,
    "summertrain (1493598719340318791)",
  );
  assert.equal(
    embed.fields?.find((field) => field.name === "Closed by")?.value,
    "Postal (staff-1)",
  );
});

test("openTicket deletes the created channel when persistence fails", async () => {
  const calls: string[] = [];
  const { openTicket } = await import("../src/services/tickets/open-ticket");

  await assert.rejects(
    openTicket(
      {
        readConfig: async () => ({ botUserId: "bot", guilds: {} }),
        reserveNextTicketNumber: async () => 1,
        createTicketInstance: async () => {
          throw new Error("persist failed");
        },
        deleteTicketInstance: async () => {
          calls.push("delete-instance");
        },
      },
      {
        createChannel: async () => {
          calls.push("create-channel");
          return { id: "channel-1" };
        },
        deleteChannel: async () => {
          calls.push("delete-channel");
        },
        createOpeningMessage: async () => {
          calls.push("opening-message");
        },
      },
      {
        guildId: "guild-1",
        openerUserId: "user-1",
        panel: {
          guildId: "guild-1",
          panelChannelId: "panel",
          categoryChannelId: "category",
          transcriptChannelId: "transcripts",
          panelEmoji: null,
          panelTitle: null,
          panelDescription: null,
          panelFooter: null,
          panelMessageId: null,
          ticketTypes: [],
        },
        ticketType: {
          id: "support",
          label: "Support",
          emoji: null,
          buttonStyle: "primary",
          supportRoleId: "role-1",
          channelNamePrefix: "support",
          questions: [],
        },
        answers: [],
      },
    ),
    /persist failed/,
  );

  assert.deepEqual(calls, ["create-channel", "delete-channel"]);
});
