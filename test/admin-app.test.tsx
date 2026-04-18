/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";
import { renderToString } from "react-dom/server";

import App, { combineDashboardErrors } from "../src/admin/App";
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



test("authenticated admin dashboard renders a sidebar shell with an overview landing page", () => {
  const html = renderToString(<App initialAuthenticated initialPath="/admin" />);

  assert.match(html, /href="\/admin"/);
  assert.match(html, /href="\/admin\/gateway"/);
  assert.match(html, /href="\/admin\/blocklist"/);
  assert.match(html, /href="\/admin\/timed-roles"/);
  assert.match(html, /href="\/admin\/tickets"/);
  assert.match(html, /aria-current="page"[^>]*>Overview</);
  assert.match(html, /Operational overview/i);
  assert.match(html, /Start gateway/i);
  assert.match(html, /Refresh dashboard/i);
  assert.doesNotMatch(html, /Load blocklist/i);
  assert.doesNotMatch(html, /Load timed roles/i);
});

test("authenticated admin dashboard keeps guild load controls in a plain shadcn layout", () => {
  const html = renderToString(<App initialAuthenticated />);

  assert.match(html, /Discord Automation/);
  assert.match(html, /Admin Dashboard/);
  assert.match(html, /mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-6/);
  assert.match(html, /rounded-lg border bg-card text-card-foreground shadow-sm/);
  assert.match(html, /method="post" action="\/admin\/logout"/);
});

test("authenticated admin dashboard avoids the old custom editor panel chrome", () => {
  const html = renderToString(<App initialAuthenticated />);

  assert.doesNotMatch(html, /Load blocklist/i);
  assert.doesNotMatch(html, /Load timed roles/i);
  assert.doesNotMatch(html, /Configure ticket buttons, questions, and transcript routing/i);
  assert.doesNotMatch(html, /Guild ID/);
});

test("authenticated admin dashboard renders overview content instead of editor sections", () => {
  const html = renderToString(<App initialAuthenticated />);

  assert.match(html, /Stored server data/i);
  assert.match(html, /Quick actions/i);
  assert.match(html, /Start gateway/i);
});

test("authenticated admin dashboard keeps navigation labels for future workflow pages", () => {
  const html = renderToString(<App initialAuthenticated />);

  assert.match(html, />Overview</);
  assert.match(html, />Gateway</);
  assert.match(html, /Blocklist/i);
  assert.match(html, /Timed Roles/i);
  assert.match(html, />Tickets</);
});

test("combineDashboardErrors preserves both overview and gateway failures", () => {
  assert.equal(
    combineDashboardErrors("Overview failed.", "Gateway failed."),
    "Overview failed. Gateway failed."
  );
  assert.equal(combineDashboardErrors(null, "Gateway failed."), "Gateway failed.");
  assert.equal(combineDashboardErrors("Overview failed.", null), "Overview failed.");
  assert.equal(combineDashboardErrors(null, null), null);
});


test("authenticated admin dashboard keeps the initial dashboard path available to the client shell", () => {
  const html = renderToString(
    <App initialAuthenticated initialPath="/admin/tickets" />
  );

  assert.match(html, /data-current-path="\/admin\/tickets"/);
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
