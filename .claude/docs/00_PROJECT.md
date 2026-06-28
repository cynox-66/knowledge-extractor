# Project Overview

## Why does this project exist?
Valuable knowledge is trapped inside walled gardens (social media, videos, PDFs). Knowledge Extractor extracts, normalizes, and transforms it into structured, searchable, AI-ready data that the user definitively owns.

## What problem does it solve?
Information is siloed and ephemeral. This project provides a robust local system to bridge that gap without relying on cloud services that compromise user privacy or control.

## Product Vision
A stable, modular, local-first platform running in-browser (starting with Instagram, scaling to Reddit/YouTube/PDFs). It provides durable local storage, media capture, OCR, semantic search, and export capabilities (Markdown/Obsidian/JSON) for personal knowledge management.

## Non-goals
- Not an engagement automator (no auto-likes/follows).
- Not an API bypass (extracts only what the user can see in-browser).
- No premature GraphRAG/cognitive-engine complexity until local extraction/OCR is perfected.

## Success Criteria
- ≥95% crawl success rate against real-world collections.
- Clean MV3-safe survival without data loss during service worker suspension.
- Accurate extraction and normalization verified by metrics.
- Flawless offline-capable local OCR and Markdown export.

## Product Constraints
- **Local-first:** User data never leaves the device unless explicitly exported.
- **Browser-bound:** Initial version must run entirely as a Chrome MV3 extension.
- **Source-agnostic:** Engine must not know about platform-specific quirks (Instagram).

## Engineering Constraints
- **MV3-safe execution:** All long-running loops must use `chrome.alarms` and persist state.
- **Measurable engineering:** Instrumentation (Metrics/Diagnostics) is mandatory.
- **Layered architecture:** Strict hierarchical dependencies (`dependency-cruiser` enforced).
- **Connector isolation:** Connectors handle extraction only. They do not orchestrate or store.
- **Durable persistence before enrichment:** All pipelines must write to IndexedDB/OPFS before moving to OCR/AI.
