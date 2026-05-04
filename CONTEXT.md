# Discord Automation Workers

A community Discord management system that helps server owners run their communities through a single bot. Features include moderation (emoji blocking), community management (LFG matchmaking, marketplace trading, support tickets), and access control (timed role assignments).

## Language

**Community Discord Management System:**
A bot-assisted framework for running Discord communities. Encompasses rule enforcement, member matchmaking, trading, support, and access control — not just moderation.
_Avoid:_ "moderation system" (too narrow)

**Moderation:**
Rule enforcement within a guild. In this system, limited to emoji reaction blocking via the blocklist.
_Avoid:_ Using "moderation" to describe LFG, marketplace, tickets, or timed roles.

**Community Management:**
Features that help guild members interact and organise: LFG (Looking For Group) matchmaking, Marketplace trading, and Ticket-based support.
_Avoid:_ "social features", "fun features"

**Access Control:**
Permission management via time-limited role assignments. Distinct from moderation — it's about participation scaffolding, not rule enforcement.
_Avoid_: "moderation" when describing timed roles

**Guild:**
A Discord server managed by this system.
_Avoid:_ "server" (ambiguous with infrastructure)

**Blocklist:**
A per-guild list of emoji that the bot will automatically remove from reactions.
_Avoid:_ "blacklist" (loaded term)

**Timed Role:**
A role assignment with an expiration time. The bot removes the role automatically when the duration elapses.
_Avoid:_ "temporary role", "expiring role"

**LFG (Looking For Group):**
A guild noticeboard where members post that they're seeking others to play with.
_Avoid:_ "group finder"

**Marketplace:**
A guild noticeboard where members post trade offers (have/want).
_Avoid:_ "trading post", "exchange"

**Ticket:**
A support conversation between a guild member and the support team, represented as a private channel.
_Avoid:_ "support request" (a ticket is the channel/instance, not the request)

## Relationships

- A **Guild** can enable any combination of features: **Blocklist**, **LFG**, **Marketplace**, **Tickets**, and **Timed Roles**
- An **LFG Post** belongs to exactly one **Guild** and one owner
- A **Marketplace Post** belongs to exactly one **Guild** and one owner
- A **Ticket Instance** belongs to exactly one **Guild**, one channel, and one ticket type
- A **Timed Role Assignment** belongs to exactly one **Guild**, one user, and one role
- A **Blocklist** config belongs to exactly one **Guild**

## Flagged ambiguities

- "Moderation" was used to describe the entire system and its Durable Object, but the only actual moderation feature is the blocklist. Resolved: system is "community management", store is being reconsidered.
- `moderation_enabled` in the database actually means "blocklist enabled for this guild". Resolved: terminology should be scoped to the blocklist.
- `GuildNotificationChannelStore` / notification channel is used for both blocklist updates and timed role events. Pending: decide if this is a "moderation log" or general "bot activity log".
