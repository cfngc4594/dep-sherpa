---
name: DepSherpa
description: An editorial proof desk for evidence-first dependency change control.
colors:
  carbon-workbench: "#171816"
  carbon-rail: "#121310"
  revision-paper: "#f3efe4"
  paper-highlight: "#fbf8ee"
  blue-black-ink: "#202927"
  muted-ink: "#59615b"
  ledger-rule: "#c9c3b5"
  proof-vermilion: "#c33a2c"
  proof-vermilion-deep: "#92281e"
  blue-pencil: "#365d72"
  approval-green: "#2f6850"
typography:
  display:
    fontFamily: "Source Serif 4, serif"
    fontSize: "clamp(2.5rem, 5vw, 4.5rem)"
    fontWeight: 720
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Source Serif 4, serif"
    fontSize: "clamp(1.5625rem, 3vw, 2.25rem)"
    fontWeight: 720
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Archivo, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  document-body:
    fontFamily: "Source Serif 4, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.62
  label:
    fontFamily: "Archivo, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.11em"
  data:
    fontFamily: "Geist Mono, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.55
rounded:
  paper: "14px"
  control: "8px"
  compact: "7px"
  icon: "12px"
  pill: "999px"
spacing:
  hairline: "1px"
  compact: "8px"
  control: "12px"
  group: "16px"
  section: "24px"
  sheet: "32px"
  field: "42px"
components:
  button-primary:
    backgroundColor: "{colors.proof-vermilion-deep}"
    textColor: "{colors.paper-highlight}"
    rounded: "{rounded.control}"
    padding: "0 17px"
    height: "42px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.control}"
    padding: "0 17px"
    height: "42px"
  mode-badge:
    backgroundColor: "transparent"
    textColor: "{colors.revision-paper}"
    rounded: "{rounded.pill}"
    padding: "8px 11px"
  change-sheet:
    backgroundColor: "{colors.revision-paper}"
    textColor: "{colors.blue-black-ink}"
    rounded: "{rounded.paper}"
    padding: "34px 42px"
---

# Design System: DepSherpa

## Overview

**Creative North Star: "The Maintainer's Proof Desk"**

DepSherpa treats dependency work as a document that must earn a signature. A dark, quiet workbench recedes behind one warm revision packet; proof marks, ruled evidence, and a side-thread of checks turn an abstract agent run into something a maintainer can inspect.

The system is dense where evidence benefits from comparison and calm where a decision needs focus. Familiar controls remain obvious, but their materials belong to editorial change control rather than a generic software dashboard.

**Key Characteristics:**

- One dominant paper surface against a carbon workspace.
- Vermilion reserved for proof marks and decisive actions.
- Blue pencil denotes retained evidence; green denotes verified approval.
- Serif type carries conclusions and document prose; sans carries operation; mono carries versions and measurements.
- State is named in text and shape, never color alone.

## Colors

The palette is restrained: warm paper and blue-black ink do most of the work, while proof, evidence, and approval each receive one disciplined signal color.

### Primary

- **Proof Vermilion:** Marks the active tab, version corrections, the primary run/approve action, and pending sign-off.
- **Deep Proof Vermilion:** Gives primary controls sufficient contrast and weight.

### Secondary

- **Blue Pencil:** Identifies retained evidence, package identity, and read-only agent instrumentation.
- **Approval Green:** Appears only for completed verification and locally approved state.

### Neutral

- **Carbon Workbench:** The main application ground.
- **Carbon Rail:** The darker navigation spine.
- **Revision Paper:** The investigation packet and document surface.
- **Paper Highlight:** High-contrast type on dark ground and bright paper details.
- **Blue-Black Ink:** Primary text on paper.
- **Muted Ink:** Secondary text on paper at accessible contrast.
- **Ledger Rule:** Dividers, tab baselines, and evidence rows.

**The Proof-Mark Rule.** Vermilion is reserved for the active investigation, a correction, or the human decision; it never becomes ambient decoration.

**The Named-State Rule.** Every colored status also has a text label, icon, line state, or border pattern.

## Typography

**Display Font:** Source Serif 4 (serif fallback)  
**Body Font:** Archivo (sans-serif fallback)  
**Label/Mono Font:** Geist Mono (monospace fallback)

**Character:** Source Serif makes findings read like considered editorial conclusions. Archivo keeps controls and operational detail compact. Geist Mono is limited to versions, dates, commands, counters, and code.

### Hierarchy

- **Display:** Heavy, tightly tracked, nearly solid leading; reserved for the active investigation question.
- **Headline:** Dense serif conclusions inside the revision packet.
- **Title:** Compact serif names for the product, package, and evidence thread.
- **Body:** Workhorse sans for interface explanation, with document prose switching to serif and staying under 68 characters per line.
- **Label:** Small, uppercase sans with measured tracking for document metadata.
- **Data:** Tabular mono for versions, dates, commands, and progress counts.

**The Three-Voices Rule.** Serif concludes, sans operates, mono measures; do not swap their jobs for decoration.

## Layout

The desktop shell uses a fixed 72px navigation rail and a fluid workspace capped at 1360px. The first viewport pairs a dominant investigation packet with a 330px audit thread. Sheet spacing progresses from 42px document fields to 24–32px sections and 8–16px control groups.

Below 1040px, the audit thread follows the packet and its stages form two columns. Below 720px, navigation moves into a 58px sticky top strip in normal flow, the packet becomes a single column, metadata stacks, and the four-field ledger becomes a two-by-two table. No fixed mobile element may cover document text.

**The Packet-First Rule.** Supporting navigation and telemetry may move, but the active change packet remains the largest and earliest surface.

## Elevation & Depth

Depth is structural rather than decorative. The revision packet receives one broad ambient shadow to separate paper from the workbench; all internal hierarchy is flat and built from tonal changes and hairline rules. Controls use a smaller downward shadow only when they represent the decisive action.

**The Desk-Surface Rule.** Only physical layers—paper over desk and decisive control over paper—receive elevation.

## Shapes

Paper uses an asymmetrical binding edge with gently curved outer corners. Controls use restrained 7–12px corners. Pills are limited to compact status metadata. Circles belong to timeline anchors and icon marks, not general containers. Hairline rules and the narrow binding create most of the geometry.

## Components

### Buttons

- **Primary:** Deep proof vermilion, paper-highlight text, 8px corners, 42px minimum height, and a small downward ambient shadow.
- **Hover / Focus:** Hover darkens and lifts by 1px; keyboard focus uses a 2px light vermilion outline with 3px clearance.
- **Ghost:** Transparent with muted ink; hover gains a quiet paper tone.
- **Disabled:** Remains legible, reduces opacity, and uses a non-action cursor.

### Chips

- **Mode badge:** A thin neutral outline and pill silhouette for static execution context.
- **Synthetic label:** Square-cornered metadata with tracked uppercase text; it must stay visually attached to the repository name.

### Cards / Containers

- **Change sheet:** The only major contained surface. It uses revision paper, a narrow binding, internal ledger rules, and ambient elevation.
- **Audit thread:** Intentionally has no surrounding card; its timeline sits directly on the workbench.

### Navigation

The current destination uses a filled vermilion icon control and `aria-current`. Future destinations stay visible only when explicitly disabled and labeled “coming later.” On mobile the rail becomes a sticky top strip in normal flow.

### Evidence Tabs

Tabs sit on the document rule and use vermilion only for the selected underline. They implement roving focus plus Left, Right, Home, and End keys, with one associated focusable tab panel.

### Approval Stamp

The pending stamp uses a dashed vermilion outline and the words “SIGN OFF / HUMAN REQUIRED.” The same button transitions to a double green “APPROVED / LOCAL ONLY” stamp after the human acts. The stamp never implies a remote write.

### Investigation Thread

Each stage combines an icon, title, evidence detail, line anchor, and completion mark. Active, complete, and pending states use both words and geometry. An atomic polite live region announces progression.

## Do's and Don'ts

### Do:

- **Do** make the evidence packet the primary surface before adding supporting telemetry.
- **Do** attach every recommendation to a source, command, patch, or explicit uncertainty.
- **Do** preserve text labels and geometric cues for every colored state.
- **Do** keep mono type confined to code, commands, versions, dates, and measurements.
- **Do** keep mobile navigation in document flow so evidence is never obscured.

### Don't:

- **Don't** turn the application into a grid of equal dashboard cards.
- **Don't** spend vermilion on passive decoration or generic emphasis.
- **Don't** use approval green before verification and human action are complete.
- **Don't** show controls that look operable without implementing or disabling them.
- **Don't** imply a branch, pull request, or message exists unless an external write actually occurred.
