/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";
import { renderToString } from "react-dom/server";

import App, { combineDashboardErrors } from "../src/admin/App";
import * as AdminAppModule from "../src/admin/App";
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
  permissionChecks: [],
};

const permissionSensitiveOverviewGuild: AdminOverviewGuild = {
  guildId: "guild-2",
  emojis: ["🚫"],
  timedRoles: [
    {
      guildId: "guild-2",
      userId: "user-2",
      roleId: "role-2",
      durationInput: "2h",
      expiresAtMs: 7_200_000,
    },
  ],
  permissionChecks: [
    {
      label: "Manage Messages in text channels",
      status: "warning",
      detail: "Manage Messages is missing in 1 of 2 visible text channels, so reaction cleanup can fail there.",
    },
    {
      label: "Timed role targets below the bot",
      status: "error",
      detail: "1 tracked timed role is at or above the bot's highest role.",
    },
  ],
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
  assert.match(html, /aria-label="Open navigation menu"/);
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

test("authenticated admin dashboard renders the gateway workspace on /admin/gateway", () => {
  const html = renderToString(
    <App initialAuthenticated initialPath="/admin/gateway" />
  );

  assert.match(html, /aria-current="page"[^>]*>Gateway</);
  assert.match(html, /Start gateway/i);
  assert.match(html, /Refresh dashboard/i);
  assert.match(html, /Current state/i);
  assert.doesNotMatch(html, /Load blocklist/i);
  assert.doesNotMatch(html, /Add timed role/i);
});

test("authenticated admin dashboard renders the blocklist workspace on /admin/blocklist", () => {
  const html = renderToString(
    <App initialAuthenticated initialPath="/admin/blocklist" />
  );

  assert.match(html, /aria-current="page"[^>]*>Blocklist</);
  assert.match(html, /id="sidebar-guild-query"/);
  assert.match(html, /Load blocklist/i);
  assert.match(html, /Apply/i);
  assert.doesNotMatch(html, /Permission check/i);
  assert.doesNotMatch(html, /live Discord permission check/i);
  assert.doesNotMatch(html, /id="bl-guild-query"/);
  assert.doesNotMatch(html, /Add timed role/i);
  assert.doesNotMatch(html, /Load ticket panel/i);
});

test("authenticated admin dashboard renders the timed roles workspace on /admin/timed-roles", () => {
  const html = renderToString(
    <App initialAuthenticated initialPath="/admin/timed-roles" />
  );

  assert.match(html, /aria-current="page"[^>]*>Timed Roles</);
  assert.match(html, /id="sidebar-guild-query"/);
  assert.match(html, /Load timed roles/i);
  assert.match(html, /Add timed role/i);
  assert.match(html, /Duration/i);
  assert.doesNotMatch(html, /Permission check/i);
  assert.doesNotMatch(html, /live Discord permission check/i);
  assert.doesNotMatch(html, /Manage Roles/i);
  assert.doesNotMatch(html, /highest role/i);
  assert.doesNotMatch(html, /id="tr-guild-query"/);
  assert.doesNotMatch(html, /Load blocklist/i);
  assert.doesNotMatch(html, /Load ticket panel/i);
});

test("authenticated admin dashboard renders the tickets workspace on /admin/tickets", () => {
  const html = renderToString(<App initialAuthenticated initialPath="/admin/tickets" />);

  assert.match(html, /aria-current="page"[^>]*>Tickets</);
  assert.match(html, /id="sidebar-guild-query"/);
  assert.match(html, /Load ticket panel/i);
  assert.match(html, /Ticket Panels|Tickets/i);
  assert.doesNotMatch(html, /Permission check/i);
  assert.doesNotMatch(html, /live Discord permission check/i);
  assert.doesNotMatch(html, /channel access/i);
  assert.doesNotMatch(html, /support roles/i);
  assert.doesNotMatch(html, /id="tp-guild-query"/);
  assert.doesNotMatch(html, /Load blocklist/i);
  assert.doesNotMatch(html, /Add timed role/i);
});

test("authenticated admin dashboard keeps the overview page free of editor controls", () => {
  const html = renderToString(<App initialAuthenticated initialPath="/admin" />);

  assert.doesNotMatch(html, /Load ticket panel/i);
  assert.doesNotMatch(html, /Load timed roles/i);
  assert.doesNotMatch(html, /Load blocklist/i);
});

test("getAdminLoginRequestPath preserves the current deep-link query", () => {
  const helper = (AdminAppModule as Record<string, unknown>).getAdminLoginRequestPath;

  assert.equal(typeof helper, "function");
  const getAdminLoginRequestPath = helper as (pathname: string, search: string) => string;

  assert.equal(
    getAdminLoginRequestPath("/admin/login", "?next=%2Fadmin%2Fgateway"),
    "/admin/login?next=%2Fadmin%2Fgateway"
  );
  assert.equal(getAdminLoginRequestPath("/admin/login", ""), "/admin/login");
});

test("getAdminLoginNavigationTarget follows redirected dashboard responses", () => {
  const helper = (AdminAppModule as Record<string, unknown>).getAdminLoginNavigationTarget;

  assert.equal(typeof helper, "function");
  const getAdminLoginNavigationTarget = helper as (responseUrl: string, redirected: boolean) => string | null;

  assert.equal(
    getAdminLoginNavigationTarget("https://runtime.example/admin/gateway", true),
    "/admin/gateway"
  );
  assert.equal(
    getAdminLoginNavigationTarget("https://runtime.example/admin/login?next=%2Fadmin%2Fgateway", false),
    null
  );
});

test("getDashboardPageDataPolicy scopes loads to the active page", () => {
  const helper = (AdminAppModule as Record<string, unknown>).getDashboardPageDataPolicy;

  assert.equal(typeof helper, "function");
  const getDashboardPageDataPolicy = helper as (path: string) => {
    loadOverview: boolean;
    loadGuildDirectory: boolean;
    monitorGateway: boolean;
    refreshOverviewAfterGatewayStart: boolean;
  };

  assert.deepEqual(getDashboardPageDataPolicy("/admin"), {
    loadOverview: true,
    loadGuildDirectory: true,
    monitorGateway: true,
    refreshOverviewAfterGatewayStart: true,
  });
  assert.deepEqual(getDashboardPageDataPolicy("/admin/gateway"), {
    loadOverview: false,
    loadGuildDirectory: true,
    monitorGateway: true,
    refreshOverviewAfterGatewayStart: false,
  });
  assert.deepEqual(getDashboardPageDataPolicy("/admin/blocklist"), {
    loadOverview: false,
    loadGuildDirectory: true,
    monitorGateway: false,
    refreshOverviewAfterGatewayStart: false,
  });
  assert.deepEqual(getDashboardPageDataPolicy("/admin/timed-roles"), {
    loadOverview: false,
    loadGuildDirectory: true,
    monitorGateway: false,
    refreshOverviewAfterGatewayStart: false,
  });
  assert.deepEqual(getDashboardPageDataPolicy("/admin/tickets"), {
    loadOverview: false,
    loadGuildDirectory: true,
    monitorGateway: false,
    refreshOverviewAfterGatewayStart: false,
  });
});

test("getSelectedGuildIdFromSearch reads the sidebar guild from the URL query", () => {
  const helper = (AdminAppModule as Record<string, unknown>).getSelectedGuildIdFromSearch;

  assert.equal(typeof helper, "function");
  const getSelectedGuildIdFromSearch = helper as (search: string) => string;

  assert.equal(getSelectedGuildIdFromSearch("?guildId=guild-2"), "guild-2");
  assert.equal(getSelectedGuildIdFromSearch("?guildId="), "");
  assert.equal(getSelectedGuildIdFromSearch(""), "");
});

test("buildAdminDashboardHref keeps the selected guild in sidebar navigation links", () => {
  const helper = (AdminAppModule as Record<string, unknown>).buildAdminDashboardHref;

  assert.equal(typeof helper, "function");
  const buildAdminDashboardHref = helper as (path: string, guildId: string) => string;

  assert.equal(buildAdminDashboardHref("/admin/tickets", "guild-2"), "/admin/tickets?guildId=guild-2");
  assert.equal(buildAdminDashboardHref("/admin/tickets", ""), "/admin/tickets");
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

test("describeError collapses HTML worker failures into a friendly dashboard message", () => {
  const helper = (AdminAppModule as Record<string, unknown>).describeError;

  assert.equal(typeof helper, "function");
  const describeError = helper as (error: unknown) => string;

  assert.equal(
    describeError(new Error("<!DOCTYPE html><html><head><title>Worker threw exception</title></head></html>")),
    "Discord lookup failed right now."
  );
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

test("guild overview card highlights permission-sensitive moderation features", () => {
  const html = renderToString(
    <GuildOverviewCard guild={permissionSensitiveOverviewGuild} guildName="Bravo" />
  );

  assert.match(html, /Permission watch/);
  assert.match(html, /Manage Messages in text channels/);
  assert.match(html, /Timed role targets below the bot/);
  assert.match(html, /reaction cleanup can fail there/i);
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
