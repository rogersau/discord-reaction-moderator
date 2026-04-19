/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Test compiled via tsconfig.tests.json.
import test from "node:test";

import { TicketService, type CreateTicketChannelConfig } from "../src/services/ticket-service";
import type { RuntimeStore } from "../src/runtime/contracts";
import type { TicketPanelConfig, TicketInstance } from "../src/types";

test("TicketService.openTicket creates channel and persists ticket instance", async () => {
  const createdInstances: TicketInstance[] = [];
  const createdChannels: Array<{
    guildId: string;
    name: string;
    parentId: string;
  }> = [];

  const store: Partial<RuntimeStore> = {
    async readConfig() {
      return { guilds: {}, botUserId: "bot-123" };
    },
    async createTicketInstance(instance: TicketInstance) {
      createdInstances.push(instance);
    },
  };

  const panel: TicketPanelConfig = {
    guildId: "guild-1",
    panelChannelId: "channel-panel",
    categoryChannelId: "category-1",
    transcriptChannelId: "channel-transcript",
    panelTitle: null,
    panelDescription: null,
    panelFooter: null,
    panelMessageId: null,
    ticketTypes: [
      {
        id: "type-1",
        label: "Support",
        emoji: null,
        buttonStyle: "primary",
        channelNamePrefix: "ticket",
        supportRoleId: "role-support",
        questions: [],
      },
    ],
  };

  const service = new TicketService(
    store as RuntimeStore,
    "bot-token",
    async (config: CreateTicketChannelConfig) => {
      createdChannels.push({
        guildId: config.guildId,
        name: config.name,
        parentId: config.parentId,
      });
      return { id: "channel-new", name: config.name };
    }
  );

  const result = await service.openTicket({
    guildId: "guild-1",
    openerUserId: "user-1",
    panel,
    ticketType: panel.ticketTypes[0],
    answers: [],
  });

  assert.equal(createdChannels.length, 1);
  assert.equal(createdChannels[0].guildId, "guild-1");
  assert.match(createdChannels[0].name, /ticket/);
  assert.equal(createdInstances.length, 1);
  assert.equal(createdInstances[0].channelId, "channel-new");
  assert.equal(result.channelId, "channel-new");
});

test("TicketService.closeTicket deletes channel and closes ticket instance", async () => {
  const closedTickets: string[] = [];
  const deletedChannels: string[] = [];

  const store: Partial<RuntimeStore> = {
    async readOpenTicketByChannel(guildId: string, channelId: string) {
      return {
        guildId,
        channelId,
        ticketTypeId: "type-1",
        ticketTypeLabel: "Support",
        openerUserId: "user-1",
        supportRoleId: "role-support",
        status: "open" as const,
        answers: [],
        openedAtMs: Date.now(),
        closedAtMs: null,
        closedByUserId: null,
        transcriptMessageId: null,
      };
    },
    async closeTicketInstance(body: {
      guildId: string;
      channelId: string;
      closedByUserId: string;
      closedAtMs: number;
      transcriptMessageId: string | null;
    }) {
      closedTickets.push(body.channelId);
    },
  };

  const service = new TicketService(
    store as RuntimeStore,
    "bot-token",
    undefined,
    async (channelId: string) => {
      deletedChannels.push(channelId);
    }
  );

  await service.closeTicket({
    guildId: "guild-1",
    channelId: "channel-123",
  });

  assert.equal(deletedChannels.length, 1, "Should delete Discord channel");
  assert.equal(closedTickets.length, 1, "Should close ticket in database");
  assert.equal(closedTickets[0], "channel-123");
});
