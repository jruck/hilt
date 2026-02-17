---
status: doing
area: engineering
icon: 🏠
tags: [iot, raspberry-pi, python]
---

# Home Automation

Local-first home automation system using Raspberry Pi and Zigbee sensors. No cloud dependencies — everything runs on the local network.

## Current Focus

Temperature-based fan control. Motion-triggered lighting is working well after the debounce fix.

## Components

- **Motion sensors** — Hallway, living room, office. Trigger lighting rules.
- **Temperature sensors** — Bedroom, office. Will drive fan control.
- **Smart plugs** — Fans, desk lamp. Controlled via Zigbee.
- **Hub** — Raspberry Pi 4 running Zigbee2MQTT + custom Python rules engine.

## Architecture

Sensors publish to MQTT. Rules engine subscribes and triggers actions. All state stored in SQLite. Web dashboard (Flask) for monitoring — not for control, just visibility.
