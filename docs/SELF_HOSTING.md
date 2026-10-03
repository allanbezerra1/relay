# Connecting real chat networks

Relay shows whatever your Matrix account can see. To get WhatsApp, Telegram and
other networks into it, you need a Matrix homeserver with bridges. There are two
ways to do that.

## Option A: use an account that already has bridges

If you already use a Matrix account with bridges set up (for example one hosted
by a friend, or by a service like etke.cc), just sign in to Relay with it.

The bridged chats show up automatically. If you also used Element there, open
**Settings → Encryption** in Relay and enter your recovery key, so that older
encrypted messages decrypt.

> **Beeper accounts:** Beeper's own login uses an email code, which Relay doesn't
> implement. Many networks in current Beeper also run *on-device* bridges inside
> the official app, so they never reach the Matrix server. Option B is the
> dependable route.

## Option B: self-host (the full "own Beeper")

You need a machine that is always on (a small VPS, a home server or a Raspberry
Pi), Docker, and a domain.

1. **Homeserver.** Install Synapse (or the lighter Continuwuity/Conduit). The
   easiest path is [matrix-docker-ansible-deploy](https://github.com/spantaleev/matrix-docker-ansible-deploy),
   which can also install and wire up every mautrix bridge for you.
   Enabling a bridge there is one line in `vars.yml`, for example
   `matrix_mautrix_whatsapp_enabled: true`.

2. **Bridges, by hand.** Each mautrix bridge follows the same pattern
   ([docs](https://docs.mau.fi/bridges/general/docker-setup.html)):

   ```bash
   mkdir whatsapp && cd whatsapp
   docker run --rm -v "$PWD:/data" dock.mau.dev/mautrix/whatsapp:latest   # writes config.yaml
   # edit config.yaml: homeserver address + domain, database, and
   # bridge.permissions: "@you:yourdomain": admin
   docker run --rm -v "$PWD:/data" dock.mau.dev/mautrix/whatsapp:latest   # writes registration.yaml
   ```

   Add `registration.yaml` to Synapse's `app_service_config_files`, restart
   Synapse, then start the bridge container.

   | Network | Image |
   | --- | --- |
   | WhatsApp | `dock.mau.dev/mautrix/whatsapp` |
   | Telegram | `dock.mau.dev/mautrix/telegram` |
   | Signal | `dock.mau.dev/mautrix/signal` |
   | Google Messages (SMS/RCS) | `dock.mau.dev/mautrix/gmessages` |
   | Instagram & Messenger | `dock.mau.dev/mautrix/meta` |
   | Discord | `dock.mau.dev/mautrix/discord` |
   | Slack | `dock.mau.dev/mautrix/slack` |
   | LinkedIn | `dock.mau.dev/mautrix/linkedin` |
   | iMessage | Needs a Mac: [BlueBubbles](https://bluebubbles.app) + mautrix-imessage, or Beeper's `imessage` bridge |

3. **Log in to each network from Relay.** Start a chat with the bridge bot (e.g.
   `@whatsappbot:yourdomain`) and send `login`. Then follow its instructions,
   such as scanning a QR code with your phone or entering a code. Your chats then
   appear in Relay with the right network badge.

Tips:
- Turn on encryption in each bridge config (`encryption: allow: true, default: true`)
  so that bridged chats are end-to-end encrypted between the bridge and Relay.
- Bridge bots announce themselves with `m.bridge` state events, which is what
  Relay uses to pick the network badge.
