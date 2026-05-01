/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import { buildAdminGuildDirectoryApiPath, buildAdminOverviewApiPath } from "../src/admin/App";
import { buildTicketResourcesApiPath } from "../src/admin/components/admin-tickets-page";

test("admin overview and guild directory refresh paths bypass cached Discord lookups", () => {
  assert.equal(buildAdminOverviewApiPath(false), "/admin/api/overview");
  assert.equal(buildAdminOverviewApiPath(true), "/admin/api/overview?refresh=1");
  assert.equal(buildAdminGuildDirectoryApiPath(false), "/admin/api/guilds");
  assert.equal(buildAdminGuildDirectoryApiPath(true), "/admin/api/guilds?refresh=1");
});

test("ticket resource refresh path bypasses cached Discord lookups", () => {
  assert.equal(
    buildTicketResourcesApiPath("guild 1", true),
    "/admin/api/tickets/resources?guildId=guild+1&refresh=1",
  );
});
