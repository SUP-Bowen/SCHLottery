## UI Design Source of Truth

When generating any user-facing UI (pages, components, marketing surfaces),
you MUST read `./DESIGN.md` first and strictly follow its color palette,
typography, spacing, depth and component-state rules.

Forbidden: hardcoding colors / fonts / radius / shadow values that are
not present in DESIGN.md.

### Active Design

- **Active:** `./DESIGN.md` — PlayStation (quiet premium dark + PS Blue + gold)
- **Archived:** `./DESIGN.bmw-m.md` — previous motorsport baseline

### Active Adaptation — SGH Lottery HUD

- Product adaptation: cyan/blue mecha HUD for `docs/` lottery console
- Do **not** use brand logos, trademarks, or copyrighted artwork
- Prefer PlayStation Blue (`#0070d1` / `#53b1ff`) as the primary signal,
  PS Plus gold for high-tier / CTA urgency, commerce red for lock/hit
- Keep the UI sparse: radar + result + one CTA; no decorative gauge clutter
- Prefer hairline frames and single-surface panels over nested frosted cards
