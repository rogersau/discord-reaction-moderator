/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";
import { renderToString } from "react-dom/server";

import App from "../src/admin/App";
import { GuildPicker } from "../src/admin/components/guild-picker";
import {
  GuildOverviewCard,
  type AdminOverviewGuild,
} from "../src/admin/components/guild-overview-card";
import { TicketPanelEditor } from "../src/admin/components/ticket-panel-editor";
import type { AdminGuildDirectoryEntry } from "../src/runtime/admin-types";

const guildDirectory: AdminGuildDirectoryEntry[] = [
  { guildId: "guild-1", name: "Alpha", label: "Alpha" },
  { guildId: "guild-2", name: "Bravo", label: "Bravo" },
];

const overviewGuild: AdminOverviewGuild = {
  guildId: "guild-1",
  emojis: ["✅"],
  timedRoles: [],
};

test("authenticated admin dashboard keeps guild load controls in a plain shadcn layout", () => {
  const html = renderToString(<App initialAuthenticated />);

  assert.match(html, /Load blocklist/i);
  assert.match(html, /Load timed roles/i);
  assert.doesNotMatch(html, /Operations Console/);
  assert.doesNotMatch(html, /rounded-\[2rem\]/);
  assert.doesNotMatch(html, /shadow-\[0_32px_90px/);
  assert.match(html, /mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6/);
  assert.match(html, /rounded-lg border bg-card text-card-foreground shadow-sm/);
  assert.match(html, /flex flex-col gap-3 border-t pt-4 sm:flex-row sm:justify-end/);
});

test("authenticated admin dashboard avoids the old custom editor panel chrome", () => {
  const html = renderToString(<App initialAuthenticated />);

  assert.doesNotMatch(html, /xl:grid-cols-5/);
  assert.doesNotMatch(html, /xl:grid-cols-6/);
  assert.doesNotMatch(html, /auto_auto/);
  assert.doesNotMatch(
    html,
    /rounded-\[1\.75rem\] border border-border\/70 bg-background\/30 p-5 lg:p-6/
  );
  assert.doesNotMatch(
    html,
    /border-t border-border\/70 pt-5 sm:flex-row sm:items-center sm:justify-end/
  );
  assert.match(html, /rounded-lg border bg-muted\/30 p-4 md:p-6/);
});

test("authenticated admin dashboard renders the ticketing section", () => {
  const html = renderToString(<App initialAuthenticated />);
  assert.match(html, /Ticket Panels/i);
  assert.match(html, /Configure ticket buttons, questions, and transcript routing/i);
});

test("authenticated admin dashboard labels guild workflows as server controls", () => {
  const html = renderToString(<App initialAuthenticated />);

  assert.match(html, /Blocklist/i);
  assert.match(html, /Timed Roles/i);
  assert.match(html, /Ticket Panels/i);
  assert.match(html, /Server/);
  assert.doesNotMatch(html, /Guild ID/);
});

test("guild picker renders searchable server labels from the guild directory", () => {
  const html = renderToString(
    <GuildPicker
      id="guild-picker"
      value="guild-2"
      guildDirectory={guildDirectory}
      loadError={null}
      onChange={() => {}}
    />
  );

  assert.match(html, /Filter servers/);
  assert.match(html, />Alpha</);
  assert.match(html, />Bravo</);
});

test("guild picker falls back to a raw guild ID input when lookup fails", () => {
  const html = renderToString(
    <GuildPicker
      id="guild-picker"
      value="guild-2"
      guildDirectory={null}
      loadError="Discord lookup failed"
      onChange={() => {}}
    />
  );

  assert.match(html, /Guild ID/);
  assert.match(html, /Discord lookup failed/);
});

test("guild overview card prefers the server name and keeps the guild ID secondary", () => {
  const html = renderToString(
    <GuildOverviewCard guild={overviewGuild} guildName="Alpha" />
  );

  assert.match(html, />Alpha</);
  assert.match(html, /guild-1/);
  assert.doesNotMatch(html, /<h3 class="mt-2 text-lg font-semibold tracking-tight">guild-1<\/h3>/);
});

test("guild overview card falls back to the raw guild ID when no server name is available", () => {
  const html = renderToString(
    <GuildOverviewCard guild={overviewGuild} guildName={null} />
  );

  assert.match(html, />guild-1</);
});

test("ticket panel editor shows friendly Discord names instead of raw IDs", () => {
  const html = renderToString(
    <TicketPanelEditor
      guildResources={{
        guildId: "guild-1",
        roles: [{ id: "role-1", name: "Support" }],
        categories: [{ id: "category-1", name: "Open Tickets" }],
        textChannels: [{ id: "transcript-1", name: "ticket-transcripts" }],
      }}
      value={{
        guildId: "guild-1",
        panelChannelId: "panel-channel-1",
        categoryChannelId: "category-1",
        transcriptChannelId: "transcript-1",
        panelTitle: null,
        panelDescription: null,
        panelFooter: null,
        panelMessageId: null,
        ticketTypes: [],
      }}
      onChange={() => {}}
      onSave={async () => {}}
      onPublish={async () => {}}
    />
  );

  assert.match(html, />Open Tickets</);
  assert.match(html, />ticket-transcripts</);
  assert.doesNotMatch(html, />category-1</);
});

test("ticket panel editor renders controls for editing ticket types and modal questions", () => {
  const html = renderToString(
    <TicketPanelEditor
      guildResources={{
        guildId: "guild-1",
        roles: [{ id: "role-1", name: "Support" }],
        categories: [{ id: "category-1", name: "Open Tickets" }],
        textChannels: [{ id: "transcript-1", name: "ticket-transcripts" }],
      }}
      value={{
        guildId: "guild-1",
        panelChannelId: "panel-channel-1",
        categoryChannelId: "category-1",
        transcriptChannelId: "transcript-1",
        panelTitle: "COLD AS F**K tickets",
        panelDescription: "To create a ticket use the Create ticket button",
        panelFooter: "TicketTool.xyz - Ticketing without clutter",
        panelMessageId: null,
        ticketTypes: [
          {
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
          },
        ],
      }}
      onChange={() => {}}
      onSave={async () => {}}
      onPublish={async () => {}}
    />
  );

  assert.match(html, /Add ticket type/);
  assert.match(html, /Add question/);
  assert.match(html, /Panel title/);
  assert.match(html, /Panel description/);
  assert.match(html, /Panel footer/);
  assert.match(html, /COLD AS F\*\*K tickets/);
  assert.match(html, /To create a ticket use the Create ticket button/);
  assert.match(html, /Ticket type label/);
  assert.match(html, /Support role/);
  assert.match(html, /Why are you opening this ticket\?/);
  assert.match(html, />Support</);
});
