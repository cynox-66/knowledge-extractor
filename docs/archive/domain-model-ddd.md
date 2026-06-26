# Core Domain Model

This document defines the conceptual language and structural boundaries of the Knowledge Extractor platform. It applies Domain-Driven Design (DDD) principles to establish a universal abstraction layer that transcends source-specific concepts.

## 1. Core Abstraction Philosophy

A significant challenge in knowledge extraction is the proliferation of platform-specific terminology: Posts, Reels, Tweets, Threads, Shorts, PDFs, and Articles.

If we model the system around these specific concepts, the architecture will inevitably bloat into a complex inheritance hierarchy (e.g., `Reel extends InstagramMedia extends SocialPost`). Every new connector would require structural changes to the core system.

**The Architectural Stance:**
Concepts like "Reel", "Post", or "PDF" **do not exist** as first-class domain objects in the core engine. They are merely presentational nuances of external systems.

Instead, the core domain relies on highly normalized, universal abstractions: `Document`, `Source`, `Media`, and `Author`. The specific _type_ of external content is preserved purely as metadata within these generic structures.

---

## 2. Ubiquitous Language

- **Provider**: The external ecosystem originating the data (e.g., Instagram, Reddit, Local File System).
- **Connector**: The boundary layer responsible for translating Provider-specific reality into our core Domain reality.
- **Document**: The universal, autonomous unit of knowledge in our system. A Document is the translation of an external concept (a Reddit Thread, an Instagram Carousel, or a PDF file) into our standardized format.
- **Source**: The provenance of a Document. It answers _where_ the knowledge came from and _when_ it was observed.
- **Media**: Binary assets (images, audio, video) embedded within or attached to a Document.
- **Author**: The external entity (user, organization, or channel) that published the Source.
- **Enrichment**: The act of synthesizing new knowledge from a Document (e.g., performing OCR on Media, or running an LLM to generate a summary).

---

## 3. Aggregate Boundaries & Entities

The system orbits around a single Aggregate Root: the **Document**.

### The Document (Aggregate Root - Entity)

The Document is the primary unit of consistency. You cannot extract, store, or process an isolated comment or an isolated image without its parent Document.

- **Role**: Contains the structured text, orchestrates its associated Media, and holds its Source provenance.
- **Granularity Challenge**: Is a Reddit Thread one Document, or is the Thread a Document and each Comment a Document?
- **Resolution**: A Document may be hierarchical. A Document can contain `ChildDocuments` (e.g., a Twitter Thread is a parent Document containing child Documents for each reply). This recursive tree structure is far more flexible than rigidly separating "Posts" from "Comments".

### Media (Entity)

A distinct asset belonging exclusively to a Document.

- **Role**: Represents a file (video, image, document scan).
- **Identity**: Identified by a unique hash of its binary contents or a system-generated ID within the scope of the Document.

---

## 4. Value Objects

Value Objects have no independent identity; their equality is determined by their structural value.

### Source (Value Object)

Describes the exact origin of the Document.

- **Attributes**: `ProviderName` (e.g., "Instagram"), `ExternalId` (the ID assigned by the Provider), `OriginalURI`, `ExtractionTimestamp`.
- **Equality**: Two Source objects are equal if they share the same `ProviderName` and `ExternalId`.

### Author (Value Object)

The originator of the content.

- _Note_: While an "Author" could technically be an Entity if we built a CRM system, for a knowledge extraction pipeline, the Author is immutable historical metadata attached to the Document at the time of extraction.
- **Attributes**: `Handle`, `DisplayName`, `AvatarURI`, `ProviderProfileURI`.

### ContentBlock (Value Object)

Instead of a single monolithic "text" field, the body of a Document is an array of `ContentBlocks`.

- **Attributes**: `Type` (Text, Heading, Quote, Code), `Value`.
- **Why**: A LinkedIn article or a Medium post has structured text. Flattening it destroys semantic meaning. A generic `ContentBlock` array gracefully handles both a simple 140-character Tweet and a complex 10-page PDF.

---

## 5. Lifecycles & State Transitions

A Document moves through a strict lifecycle pipeline. It cannot skip states.

1.  **Discovered**: The Connector has identified a Source (e.g., intercepted an API response) but has not yet parsed it.
2.  **Extracted**: The raw data has been parsed into a Document in memory. Associated Media URIs are known, but the binary data has not been downloaded.
3.  **Hydrated**: All Media binaries associated with the Document have been downloaded and localized.
4.  **Enriched**: Background processes have executed against the Document. For example, the OCR engine has scanned a Media asset and appended a new `ContentBlock` to the Document containing the transcribed text.
5.  **Persisted**: The fully formed Document has been committed to the Storage Engine.
6.  **Exported**: The Document has been successfully synchronized to a downstream system (e.g., Notion, Obsidian).

---

## 6. Ownership & Invariants

- **Ownership Rule 1**: A Document owns its Media. If a Document is deleted from the system, its localized Media binaries must be garbage collected.
- **Ownership Rule 2**: A Document owns its Source. A Source cannot exist independently.
- **Invariant 1 (Identity)**: A Document's system ID must be a deterministic derivative of its `Source` (e.g., a hash of `ProviderName + ExternalId`). This guarantees idempotency. If the engine extracts the same Instagram post twice, it overwrites the existing Document rather than duplicating it.
- **Invariant 2 (Immutability of Source)**: Once a Document is extracted, its `Source` and `Author` metadata cannot be modified by the user or the Enrichment engines.
- **Invariant 3 (Enrichment Additive)**: Enrichment processes (OCR, AI tagging) are strictly additive. They append metadata or `ContentBlocks` but must never destructively overwrite the original extracted text.

---

## 7. Relationship to Future Connectors

By normalizing "Reel" and "PDF" into the `Document` + `Media` model, adding a new connector requires zero changes to the Domain layer.

- **Instagram Reel**: Becomes a `Document` with zero text `ContentBlocks`, containing one `Media` (video), with an `Author` (the account).
- **Instagram Carousel**: Becomes a `Document` with multiple `Media` (images), preserving order.
- **PDF**: Becomes a `Document` with `Media` (the PDF file). Upon Enrichment, the OCR engine reads the PDF and populates the `ContentBlocks`.
- **Reddit Thread**: Becomes a parent `Document` containing text `ContentBlocks` (the main post), and a collection of child `Document` aggregates (the comments).

This guarantees extreme extensibility. The core storage, AI, and export engines only ever operate against this single unified Domain Model.
