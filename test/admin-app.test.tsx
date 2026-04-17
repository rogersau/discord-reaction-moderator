/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";
import { renderToString } from "react-dom/server";

import App from "../src/admin/App";
import { TicketPanelEditor } from "../src/admin/components/ticket-panel-editor";

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
