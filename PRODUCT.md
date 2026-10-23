# Product

## Register

product

## Users
QA testers and developers on the MMCY fleet team. They use the page to stand in for the recruiter-side system while testing the hosted Fleet dev site: create a candidate, watch Fleet match and approve it, then request the reservation. They repeat this loop many times per session, often for several candidates at once, and several testers share the same mock and see each other's candidates.

## Product Purpose
A mock of the external recruiter application. It sends candidates into Fleet's intake API, receives Fleet's "ready for reservation" callback, and lets the tester fire the reservation request. Success means a tester can create a correctly placed candidate in seconds and tell, at a glance, which step each candidate's trips are at and what to do next.

## Brand Personality
Calm, fast, exact. An internal instrument, not a product showcase: plain language, no decoration, state made obvious. It should feel trustworthy enough that when something fails, the tester believes the page and looks at Fleet, not the other way round.

## Anti-references
- Marketing or SaaS landing-page styling: hero banners, gradients, glossy cards, decorative illustration.
- Admin dashboards stuffed with metrics and charts nobody needs for this loop.
- Debug-tool clutter where raw JSON and internals crowd out the task.

## Design Principles
- The create flow comes first: the form is the page's center of gravity; everything else supports it.
- Show what will be sent before it is sent: resolved places, directions and defaults are visible while filling the form, not discovered after submit.
- State over decoration: every candidate's per-trip status and the next available action are readable without opening anything.
- Shared and risky things stay out of the way: settings that affect every tester sit folded and clearly labelled.
- Failures speak plainly: say what failed and where to look (mock, Google, or Fleet).

## Accessibility & Inclusion
WCAG 2.1 AA basics: 4.5:1 text contrast, full keyboard operation (including the place-search listbox), visible focus, semantic labels, and `prefers-reduced-motion` respected.
