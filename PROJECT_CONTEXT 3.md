# Knowledge Extractor — Project Context

Version: 0.1.0

Status: Active Development

---

# Mission

Knowledge Extractor is a modular knowledge ingestion platform.

The project is NOT an Instagram scraper.

Instagram is only the first connector.

The long-term objective is to build an extensible platform capable of extracting structured knowledge from multiple information sources and transforming it into a searchable personal knowledge base.

Future connectors include:

- Instagram
- Reddit
- X (Twitter)
- LinkedIn
- YouTube
- PDFs
- Web Articles
- Additional connectors as required

---

# Core Philosophy

Separate extraction from processing.

Separate platform logic from connector logic.

Separate knowledge extraction from AI enrichment.

Every subsystem should be replaceable without affecting unrelated parts of the architecture.

---

# Primary Objectives

The platform should:

- Discover content
- Extract structured information
- Download media
- Perform OCR
- Normalize extracted information
- Store extracted knowledge
- Export structured datasets
- Support downstream AI enrichment

The extension is responsible only for collection.

AI processing happens outside the browser.

---

# Non Goals

The project is NOT intended to:

- Automate social media interactions
- Perform engagement
- Send messages
- Like posts
- Follow users
- Circumvent authentication
- Replace official APIs where they exist

The system operates only on content that the authenticated user already has access to.

---

# High Level Architecture

User

↓

Extension UI

↓

Background Worker

↓

Connector

↓

Extraction Engine

↓

Storage Engine

↓

Export Engine

↓

AI Pipeline (External)

↓

Knowledge Base

---

# Connector Philosophy

Every source is implemented as an independent connector.

A connector owns:

- navigation
- selectors
- extraction logic
- normalization rules
- source-specific models

A connector must never contain:

- storage logic
- OCR implementation
- exporter logic
- AI logic

The connector only knows how to transform a source into a generic extracted document.

---

# Shared Packages

packages/types

Contains only interfaces and shared models.

packages/shared

Shared utilities.

Configuration.

Logging.

Constants.

Errors.

packages/extractor

Extraction pipeline.

Validation.

Normalization.

packages/storage

Persistence layer.

IndexedDB.

Future storage providers.

packages/exporters

JSON

Markdown

CSV

SQLite

Future exporters.

packages/ocr

OCR abstraction.

Image preprocessing.

OCR providers.

packages/ai

External AI integration.

Prompt builders.

Knowledge transformation.

---

# Architectural Rules

Rule 1

Instagram-specific code never leaves connectors/instagram.

Rule 2

No package may depend on apps/.

Rule 3

Shared packages must not import connectors.

Rule 4

All communication should happen through interfaces.

Rule 5

Avoid circular dependencies.

Rule 6

Prefer composition over inheritance.

Rule 7

Every new subsystem must be independently testable.

Rule 8

No business logic inside the popup UI.

---

# Development Principles

Every feature follows:

Research

↓

Architecture

↓

Implementation

↓

Review

↓

Testing

↓

Documentation

↓

Commit

Never skip architectural reasoning.

Never implement directly without understanding dependencies.

---

# Current Development Stage

Sprint 0

Goal:

Build the engineering platform.

Current priorities:

- monorepo setup
- build tooling
- TypeScript configuration
- shared interfaces
- extension bootstrap
- message passing
- project infrastructure

No extraction logic should be implemented until the platform is stable.

---

# Future Milestones

M0

Development Platform

M1

Instagram Discovery

M2

Metadata Extraction

M3

Media Extraction

M4

OCR

M5

Export System

M6

Incremental Sync

M7

AI Enrichment

M8

Additional Connectors

---

# Long-Term Vision

Knowledge Extractor should evolve into a universal knowledge ingestion platform.

The same extraction pipeline should support:

Instagram

↓

Reddit

↓

LinkedIn

↓

X

↓

YouTube

↓

PDF

↓

Articles

↓

Unified Knowledge Representation

↓

Search

↓

AI

↓

Personal Knowledge Base

No architectural decision should make future connectors significantly harder to implement.

Every implementation should optimize for maintainability, extensibility, and long-term engineering quality over short-term convenience.
