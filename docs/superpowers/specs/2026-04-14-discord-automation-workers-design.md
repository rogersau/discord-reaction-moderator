# Discord Automation Workers Rebrand and Deploy-Button Design

## Problem

The repository is still named and framed as **Discord Reaction Moderator**, but the shipped code now covers a broader set of Discord automation capabilities: reaction moderation, blocklist management, gateway/session automation, and timed roles. The repo identity and onboarding docs should reflect that broader scope.

This change should rebrand the existing repository as a broader Cloudflare-based Discord automation suite, improve the README so it works as a landing page for the suite, and add a working **Deploy to Cloudflare** entry point in the README.

## Goals

- Rebrand the existing repository in place as `rogersau/discord-automation-workers`
- Update the README so it presents the project as a **suite of Discord automation workers**
- Preserve current runtime behavior while aligning names, descriptions, and onboarding copy with the broader project scope
- Add a **Deploy to Cloudflare** button to the README that targets the renamed public repository
- Improve deploy-time guidance so the Cloudflare deploy flow explains required Discord values and secrets clearly

## Non-Goals

- No new Discord automation features
- No changes to moderation, gateway, slash-command, or timed-role behavior
- No attempt to create a second repository or split the codebase into multiple packages
- No expansion of the deploy button beyond the README

## Current Context

The current README already documents functionality beyond reaction moderation:

- Guild-scoped slash command blocklist management
- Timed role commands
- Gateway session bootstrapping and status APIs
- Cloudflare Durable Object storage and scheduling

The repo name and top-level framing have not caught up with the actual surface area of the codebase.

## Decision Summary

### Repository identity

- **Repository owner:** `rogersau`
- **Migration strategy:** rename the existing repository in place
- **Chosen repository name:** `discord-automation-workers`

Renaming in place preserves repository history, stars, issues, and links that GitHub can redirect, while giving the project a name that matches both its current capabilities and its Cloudflare Worker implementation.

### Positioning

The repository will be positioned as a **Cloudflare-based suite of Discord automation workers**. The current features will be described as the first workers/modules in the suite rather than as unrelated add-ons attached to a reaction moderation project.

## README Design

The README will be restructured as a suite landing page with the following shape:

1. **Title and summary**
   - New project name
   - Short description centered on Discord automation workers on Cloudflare

2. **Deploy to Cloudflare button**
   - Placed near the top of the README
   - Uses Cloudflare's standard markdown snippet
   - Targets the renamed GitHub repository URL

3. **Current tools / suite modules**
   - Reaction moderation
   - Blocklist management
   - Gateway/session automation
   - Timed roles

4. **Architecture and deployment model**
   - Durable Objects, slash commands, interactions endpoint, scheduled bootstrap, and admin APIs

5. **Setup and deployment**
   - Existing setup steps retained
   - Reworded so they describe suite deployment rather than a single-purpose moderator

6. **Operations and command reference**
   - Existing operational detail retained where still accurate

7. **Public repo note**
   - Explicit note that Deploy to Cloudflare requires a public GitHub or GitLab repository

The README should stay honest about what exists today while leaving room for future workers under the same umbrella.

## Deploy-to-Cloudflare Design

The deploy button will use Cloudflare's standard pattern:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rogersau/discord-automation-workers)
```

To make the deploy flow clearer for users, the repo should also include supporting metadata:

- `wrangler.toml` remains the source of truth for Worker configuration and resource bindings
- `package.json` should include `cloudflare.bindings` descriptions for the Discord variables/secrets that users must supply
- A `.dev.vars.example` file should be added so Cloudflare can surface secret prompts cleanly during deploy

This makes the button both visible in the README and useful during Cloudflare's deployment flow.

## Files Expected to Change

- `README.md`
- `package.json`
- `wrangler.toml` if any naming or template-friendly defaults need adjustment
- `.dev.vars.example`

## Behavior and Compatibility Constraints

- Runtime behavior should remain unchanged unless a rename directly requires a string update
- Any change to the Worker name in `wrangler.toml` must be treated carefully because it affects deployment identity
- Public-facing docs must stay consistent with the actual current feature set
- The deploy button should assume the renamed repository is public, since private repositories are not supported by Cloudflare's deploy-button flow

## Validation

Validation should confirm that:

- The README accurately reflects the broader suite identity
- The Deploy to Cloudflare button points at the correct renamed repository URL
- Package and Wrangler metadata remain coherent after the naming pivot
- Existing type-check and test commands still succeed after the documentation/metadata changes

## Operational Follow-Through

The codebase changes prepare the repository for the rename. The actual repository rename itself is an operational step that can be performed on GitHub or via the GitHub CLI, depending on available permissions and preference.

## Outcome

After this work, the project should present as **Discord Automation Workers**: a Cloudflare-first suite of Discord automation tools with clearer branding, a more accurate README, and a one-click Cloudflare deployment entry point.
