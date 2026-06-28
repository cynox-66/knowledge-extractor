# Technology Research and Landscape

This document surveys major technologies relevant to our knowledge platform, focusing on storage, data handling, AI, and tooling. For each technology we cover its purpose, architecture, performance, complexity, scalability, offline support, browser compatibility, maintenance, community adoption, maturity, benchmarks (if available), future outlook, alternatives, and migration/replacement paths. At the end we recommend an ideal stack for various stages (Beta, Prod v1, 100k users, 1M users), optimizing for engineering quality and long-term viability.

## Storage

### IndexedDB  
- **Purpose**: Client-side NoSQL storage in browsers, handling structured data, JSON and blobs. It provides an object store per origin, with key–value semantics.  
- **Architecture**: Asynchronous JavaScript API built on top of SQLite (in Chrome/Firefox) or LevelDB (in Edge). Data is persisted in the browser’s profile and survives restarts. Transactions and indexes are supported.  
- **Performance**: Good for moderate data sizes. Bulk reads/writes can be slow (inserting hundreds of records can take seconds). Sequential access and indexed queries are efficient; large binary blobs are handled but not ideal at high throughput.  
- **Complexity**: Relatively low-level API (keys, cursors). Can use wrappers (Dexie, RxDB) for convenience.  
- **Scalability**: Suitable for megabytes to low gigabytes per origin (subject to browser storage quota). Good for data that fits on a single device.  
- **Offline**: Yes – data persists across sessions.  
- **Browser Support**: All modern browsers (Chrome, Firefox, Edge, Safari) support IndexedDB. Opera and mobile browsers likewise. Good coverage.  
- **Maintenance**: Minimal (built-in). No external dependencies. Some quirks (schema evolution) can add maintenance overhead.  
- **Community & Maturity**: Very mature; core web standard since ~2013. Massive usage in PWA, extensions, browsers.  
- **Benchmarks**: Varies by engine. RxDB notes IndexedDB is slower than native DBs. Wa-sqlite IDBBatchAtomicVFS benchmarks show ~6K inserts/sec on Chrome when optimized.  
- **Future Outlook**: Continues as primary client DB. IndexedDB2 specs add SQLite-compatible JSON, bigger quotas, etc. Likely stable for years.  
- **Alternatives**: localStorage (too small, no indexing), WebSQL (deprecated), file APIs (OPFS below), SQLite‐WASM (SQLite in browser).  
- **When to Use**: Storing structured app data, metadata, JSON, or moderate blobs in-browser; extension data; offline support.  
- **When *Not* to Use**: Ultra-low-latency needs; extremely large binary files (prefer OPFS or external); complex relational queries.  
- **Migration/Replacement**: Data can migrate to SQLite-Vec or Postgres (PGlite) if complex queries needed. Could move to cloud DB if sync.  

### Origin Private File System (OPFS)  
- **Purpose**: A virtual file system for the origin, allowing in-browser file storage with high performance. Suitable for large binaries or full-disk databases.  
- **Architecture**: Part of the File System Access API (navigator.storage.getDirectory()). Provides a private directory invisible to the user. Files can be read/written byte-by-byte. Supports synchronous writes in Web Workers (via `getFileHandle()` and `createSyncAccessHandle()`).  
- **Performance**: High. Writes are *in-place*, bypassing security checks of user-visible files. Markedly faster for large writes (like SQLite DB updates) than IndexedDB-backed file APIs. Chrome’s OPFS is optimized for performance; concurrent access requires careful handling but is supported (OPFSCoopSyncVFS in wa-sqlite, for example).  
- **Complexity**: Moderate API (async JS, promise-based). Some complexity in async vs sync calls. Requires managing directories/handles.  
- **Scalability**: Governed by same storage quotas as IndexedDB (site-specific). Typically several GB at least on desktop.  
- **Offline**: Yes, persistent. Data stays on disk per origin.  
- **Browser Support**: Chrome 94+, Edge (Chromium), Safari 16+, Firefox 111+ (as of 2023). Modern versions largely support it; older browsers do not (need fallback to IndexedDB).  
- **Maintenance**: Low (standard API). Implementation details rarely change.  
- **Community & Maturity**: New (since ~2022), but quickly adopted by PWAs. Still stabilizing in spec.  
- **Benchmarks**: Wa-sqlite reports OPFS writes are fast and preserve SQLite file format (file-system transparency).  
- **Future Outlook**: Likely to become default for browser-based DB storage (replacing IndexedDB for file-based DBs). 
- **Alternatives**: IndexedDB (via SQLite VFS), temporary File System API (deprecated), In-memory DB.  
- **When to Use**: Storing large binaries (images, audio, video files), SQLite databases (improved performance), any file-like data.  
- **When *Not* to Use**: Storing discrete JSON objects (IndexedDB is more natural there), if needing to share data between domains (OPFS is origin-scoped).  
- **Migration**: Data stored in OPFS is a real file, so migrating means copying or reading file (and can reuse file across contexts). If OPFS not available, fall back to IndexedDB VFS as in wa-sqlite.  

### SQLite in WebAssembly (sqlite-wasm)  
- **Purpose**: Full SQLite engine compiled to WebAssembly, enabling SQL queries client-side.  Good for complex relational data and ad-hoc queries offline.  
- **Architecture**: SQLite C code compiled to WASM (usually via Emscripten). Provides a synchronous SQLite API (sql.js, wa-sqlite) that can use different virtual file systems (VFS) to persist data (IndexedDB or OPFS). Example libraries: [wa-sqlite](https://github.com/wa-sqlite/wa-sqlite), sql.js (asm.js version), subframe7536/sqlite-wasm. PGlite is an alternative (Postgres WASM).  
- **Performance**: Reasonable but slower than native. Overhead from WASM interpreter. However, with OPFS and proper VFS (batch writes, exclusive mode), Wa-sqlite can achieve thousands of ops/sec. Query speed is typically slower than native but still performant for moderate data.  
- **Complexity**: Higher (heavy binary ~1MB+). Using it is simpler (SQL interface) but bundling is large. Need to manage asynchronous calls.  
- **Scalability**: Limited by device resources. Good up to hundreds of MB or more if optimized. Concurrency limited: SQLite is single-writer by default (but multi-reader). Wa-sqlite supports exclusive mode for speed; concurrent writes require serialization (OPFSCoopSyncVFS supports multi-connection with locking).  
- **Offline**: Yes (data persisted via IndexedDB or OPFS).  
- **Browser Support**: Any browser with WebAssembly and OPFS (for best perf) or IndexedDB. Essentially all modern browsers.  
- **Maintenance**: Medium – need to update WASM build with SQLite versions for bug fixes. Community projects actively maintain builds.  
- **Community & Maturity**: Growing. SQLite itself is mature. Web builds (sql.js) have been around 5+ years, wa-sqlite and PGlite are newer (2023-2025) and maturing fast.  
- **Benchmarks**: Wa-sqlite + IndexedDB can do ~6000 write tx/s (with exclusive locking). OPFS yields similar throughput; wa-sqlite + OPFS (OPFSCoopSyncVFS) handles ~6K inserts/sec with synchronous writes.  
- **Future Outlook**: Promising for complex local data needs. With OPFS support, it will likely outpace IndexedDB for speed and flexibility. PGlite (Postgres) is a newer alternative for those requiring full SQL compatibility.  
- **Alternatives**: SQLite-Vec (SQLite with vector extension), PGlite (WASM Postgres), DuckDB-WASM, or using IndexedDB natively with a query engine library.  
- **When to Use**: Needed if you require SQL (joins, indices) offline, complex queries, or data migrations (table schemas). Good for local analysis or when existing SQL logic should be reused.  
- **When *Not* to Use**: Simple key–value data or when payloads are small (IndexedDB simpler). Very large datasets (if beyond quotas) or heavy concurrent writes.  
- **Migration/Replacement**: Can export to SQLite file and import into server-side Postgres or DuckDB for scaling. Data in OPFS is bitwise compatible with desktop SQLite (file-transparency), easing migration.  

### SQLite-Vec  
- **Purpose**: An extension for SQLite that adds native vector data types and nearest-neighbor search. It brings vector database capabilities into SQLite.  
- **Architecture**: Implemented in C as a SQLite extension (packaged for various language bindings). Defines vector types (float32, int8, bit) and vector math functions (L2, L1, cosine, Hamming). Uses virtual tables for KNN queries.  
- **Performance**: Optimized with SIMD (AVX/NEON) for operations. For moderate embedding sizes, performance is “fast enough” for local search. Does linear scan by default but with indexing on rowids for filtering. Not a full ANN index (compared to FAISS), but extension is lightweight.  
- **Complexity**: Simple to use if you already use SQLite – just `LOAD EXTENSION`. No separate service needed. Requires SQLite build with extension.  
- **Scalability**: Limited by SQLite’s single-threaded design. Good for thousands to low millions of vectors in-memory; not designed for huge-scale vector search.  
- **Offline**: Yes (runs entirely in-process).  
- **Browser Support**: Only if running SQLite-WASM with this extension (not trivial to compile). More of a server/runtime tool currently.  
- **Community & Maturity**: New (v0.1.0 in early 2025). Maintained by Mason Projects (Mozilla Builders). Interest is growing.  
- **Benchmarks**: Not widely published. Expected to be slower than specialized vector DBs for large data, but sufficient for small-scale semantic search.  
- **Future Outlook**: Could become default for local semantic search, eliminating need for separate vector DB in some apps. As SQLite itself is ubiquitous, adoption can grow.  
- **Alternatives**: Dedicated vector DB (Qdrant, Chroma, Pinecone), or use SQLite plus an external vector library (e.g. Faiss on file).  
- **When to Use**: If you already use SQLite and want to add semantic search to that dataset without new infrastructure. Good for desktop apps or extensions.  
- **When *Not* to Use**: High-throughput or large-scale vector search (use specialized DB). Multi-language cloud deployment where you want separate service.  
- **Migration/Replacement**: If SQLite-Vec cannot keep up, data can be migrated to a full vector DB (like Qdrant). Since data is stored in SQLite, export to CSV+embeddings and import to vector DB.

### PGlite (Postgres in WebAssembly)  
- **Purpose**: Full PostgreSQL engine compiled to WASM, enabling Postgres features (SQL, extensions) in-browser or in JS environments.  
- **Architecture**: Based on Postgres single-user mode. WASM binary (<3MB gzipped) runs with a JS API (`PGlite` client library). Supports pgvector, PostGIS, etc. Uses IndexedDB or Node filesystem for persistence.  
- **Performance**: Limited to single connection (no forking). Faster than spinning up remote DB, but slower than native. Complex SQL might be slow due to WASM overhead. Good for small-to-medium data.  
- **Complexity**: Higher. Requires bundling the library. But API is familiar SQL. Less mature API docs (Alpha status as of mid-2025).  
- **Scalability**: Single-user; not for concurrent accesses. Data size limited by IndexedDB/quota.  
- **Offline**: Yes (persists to IndexedDB or Node FS).  
- **Browser Support**: Via WASM and OPFS/IndexedDB; works in modern browsers.  
- **Maintenance**: Heavily under development (Electric-sql). Maintainers must keep up with Postgres changes.  
- **Community & Maturity**: Very new (2024-25). Electric-sql backing and Supabase mention. Early adoption.  
- **Benchmarks**: No public benchmarks yet. Likely slower than SQLite-WASM for small queries due to heavier engine, but handles more Postgres features.  
- **Future Outlook**: A niche but powerful option. If robust, it could unify client/server DB code (same SQL). But heavy for most cases.  
- **Alternatives**: SQLite-WASM, DuckDB-WASM.  
- **When to Use**: When you need Postgres-specific extensions (pgvector, PostGIS) offline, and are willing to accept single-connection mode. Possibly for migrating workflows to/from Postgres.  
- **When *Not* to Use**: For simple data, SQLite is lighter; if you need high concurrency or performance, skip it.  
- **Migration**: Data in PGlite can be exported to real Postgres (SQL dump). Because it uses Postgres data files, tools can potentially read OPFS-stored DB file, but not easily.  

### DuckDB-Wasm  
- **Purpose**: DuckDB in WebAssembly (in-browser). An embedded OLAP database with SQL. Designed for analytical queries (e.g. reading Parquet/CSV).  
- **Architecture**: DuckDB engine compiled to WASM. Supports Arrow, Parquet, JSON I/O. Runs fully client-side. Single-thread (multithreading experimental).  
- **Performance**: Good for analytical workloads; columnar engine. Optimized for large scans. Comes with Arrow and Parquet support. Single-threaded WASM limits throughput, but for moderate data it’s fast.  
- **Complexity**: Large codebase, but API is SQL. Build size is sizable. Integrating it in code is straightforward (via npm or CDN).  
- **Scalability**: Handles GBs of data if memory allows (it streams from files when possible). Not distributed; limited by browser memory.  
- **Offline**: Yes. Can attach to OPFS or fetch remote CSV/Parquet.  
- **Browser Support**: All modern browsers with WASM. The GitHub page notes testing on Chrome, Firefox, Safari.  
- **Maintenance**: Maintained by DuckDB team. High activity.  
- **Community & Maturity**: DuckDB is very popular (esp. Python/R users). WASM version is mature and actively improved.  
- **Benchmarks**: Very efficient at large queries; often outperforms SQLite for analytical tasks. I/O can be bottlenecked by browser limitations.  
- **Future Outlook**: Likely to grow in analytics space. Seamless SQL for big data in-browser could be powerful.  
- **Alternatives**: SQLite-WASM (row-store, good for transactions), other query engines (SQL.js).  
- **When to Use**: For heavy data analysis or querying large JSON/Parquet in-browser. If you want SQL to query your dataset column-wise.  
- **When *Not* to Use**: If your need is small or transactional. For write-heavy OLTP, SQLite may be better.  
- **Migration**: DuckDB files (.duckdb) can be shared with native DuckDB, easing migration. 

### Blob and File Storage  
- **Purpose**: Storing binary data (images, audio, video) either in-browser or in cloud.  
- **Client-side**: Blob objects (JavaScript), File API, IndexedDB (supports Blob values), OPFS (as files). Browser caches, Cache API or Service Worker cache can hold assets.  
- **Server/cloud**: Object storage services (AWS S3, Google Cloud Storage, Azure Blob). Decouples from user device; for sync or sharing.  
- **Performance**: Browsers: storing large blobs in IndexedDB can be slow; OPFS is better for files. Cloud storage has network latency but high throughput.  
- **Complexity**: Using Blobs in IndexedDB is straightforward; OPFS API for files is more code. Cloud storage requires integration and auth.  
- **Scalability**: IndexedDB/OPFS limited by device; cloud is virtually unlimited.  
- **Offline**: Client: yes; Cloud: no (unless local caching).  
- **Maintenance**: Cloud requires managing accounts/keys. Browser built-ins minimal.  
- **Community & Maturity**: Standard tech. Many libs (aws-sdk, etc.).  
- **Benchmarks**: Vary. Cloud often faster for large data (high bandwidth), but depends on network.  
- **When to Use**: In-browser: small images, audio clips. For large files use OPFS. Cloud: for backups, cross-device sync, collaborative features.  
- **When *Not* to Use**: Cloud if offline-only scenario. Local if you need global access.  
- **Migration**: Can sync OPFS data to cloud (upload), or read IndexedDB.

## OCR (Optical Character Recognition)

- **Tesseract.js (WASM)**: The JavaScript port of Tesseract OCR. **Purpose**: Extract text from images client-side. **Performance**: Slower than native (WASM), but avoids server. Works best on clean, page-like images (scans). Accuracy is good for printed text, degrades on stylized fonts. **Complexity**: Bundling ~1.4MB; using it in an offscreen worker is common. **Offline**: Fully offline. **Browser Support**: Any with WASM. **Community**: Established, open-source. **Trade-offs**: Accurate in many cases but can struggle with handwriting/low-res. *Alternatives*: Cloud OCR (see below), or machine-learning models like PaddleOCR via WASM (rare).  
- **PaddleOCR**: Open-source OCR from PaddlePaddle (Baidu). **Pros**: Supports many languages, well-optimized for CPU/GPU. **Cons**: No standard JS port (Python/TensorFlow). Likely used server-side or via WASM (not mainstream yet).  
- **EasyOCR**: PyTorch-based OCR (80+ languages). **Pros**: Good “in-the-wild” accuracy (scene text). **Cons**: Python only (server). No direct browser use.  
- **MMOCR**: OpenMMLab’s OCR toolbox (PyTorch). High accuracy but complex.  
- **Google Vision OCR (Cloud)**: **Pros**: Very high accuracy, robust (handles poor scan, multi-language). **Features**: TEXT_DETECTION and DOCUMENT_TEXT_DETECTION modes for freeform or dense text. **Cons**: Paid service (~$0.0015/page), requires internet. Proprietary (no local control). **Use if** quality is critical (scientific, OCR of receipts, etc).  
- **Amazon Textract / Azure OCR**: Similar to Google’s, with specialized features (form parsing, tables).  
- **Vision-enabled LLMs (GPT-4o, Gemini)**: These can “see” and output text, among other info. **Pros**: Use a single API call to get text (and context). **Cons**: Latency and cost can be higher; still emerging in reliability. Example: GPT-4 with vision can read images (OpenAI docs).  
- **Benchmarks**: In a 2022 invoice test, Google Vision outperformed Tesseract on small text (though Tesseract was faster). In general, cloud OCR bests open-source on noisy or tiny text, but costs money.  
- **When to Use**:  
  - **Tesseract.js** – for local/offline OCR on reasonably clear images; free and easy.  
  - **Cloud OCR APIs** – for highest accuracy on diverse or poor-quality documents, when offline not needed.  
  - **Vision LLM** – when you already use GPT/Gemini API for other tasks, for quick prototyping.  
- **When *Not* to Use**: Tesseract if very high accuracy needed; Cloud OCR if offline or cost is an issue.  
- **Migration**: Start with Tesseract.js for Beta (no infra needed). In Prod, offer optional integration with Google/Azure for premium users.  

## Vision AI (Computer and Visual Intelligence)

- **Multimodal LLMs**: Models like **OpenAI’s GPT-4o (Vision)**, **Claude Vision**, **Google Gemini 3**, **Meta LLaVA/GPT** are capable of interpreting images. They can perform OCR, captioning, question-answering on images, etc. For example, GPT-4o can extract text and analyze charts. These models *see and describe* at a high level, integrating image understanding with knowledge. **Pros**: High-level comprehension (labels, summarization). **Cons**: Requires cloud API (except emerging open models), unpredictable on non-photographic content.  
- **CLIP (Contrastive Language-Image Pre-training)**: OpenAI’s model (ViT image encoder + text encoder). Maps images and text to a shared vector space. **Use**: Compute embeddings for images, enabling similarity search (image ↔ text retrieval) and simple zero-shot classification (via nearest-neighbor to text prompts). **Performance**: Fast inference. **Limitations**: No structural output (just embedding).  
- **Segment Anything Model (SAM)**: Meta’s foundation model for segmentation. Given an image (and optional prompts), it identifies and masks objects. Useful for image preprocessing (e.g. cropping document regions) or feature extraction.  
- **Object Detection/Classification models**: Pretrained models (YOLOv8, SSD, Faster R-CNN, etc) – often via frameworks like TensorFlow.js or ONNX Web. **Use**: Detect common objects, logos, scenes in images for categorization or metadata. Also vision APIs (Google Cloud Vision, Azure Computer Vision) can return labels, text, faces.  
- **Document Layout Analysis**: Specialized models (LayoutLM, Donut) parse document structure (tables, forms, receipts). For example, Hugging Face’s Transformers include LayoutLM (for PDFs) and Blip (image captioning). These can extract structured data from images of pages.  
- **Benchmarks/Trade-offs**: CLIP is state-of-the-art for zero-shot image tasks. Vision LLMs (GPT-4o/Gemini) produce fluent descriptions but are opaque and require trust in a cloud provider.  
- **When to Use**:  
  - **CLIP/embedding models** for search and similarity.  
  - **Vision APIs/LLMs** for quick content understanding if API usage is acceptable.  
  - **Custom CV models** (YOLO, SAM) when specific features (logo detection, segmentation) are needed.  
- **When *Not* to Use**: Complex vision tasks may exceed LLM context (e.g., heavy video analysis). If offline only, these require inference libraries (ONNX/TensorFlow.js) with limited power.  
- **Future Outlook**: Vision AI is rapidly advancing; browser inference via WebGPU and WASM may become feasible for some models (e.g. ONNX Web, Tiny Vision models).  

## Speech-to-Text (ASR)

- **OpenAI Whisper**: Open-source model (fast & large versions) for transcription. **Pros**: Free to self-host; handles accents & noise well. **Cons**: Needs GPU for speed; base model can be error-prone on difficult audio. As of 2025, OpenAI’s cloud APIs use GPT-4 architecture (“gpt-4o-transcribe”) which greatly improved Whisper’s accuracy (Clean English WER ~2.5%).  
- **Cloud ASR (OpenAI, Google Chirp, Amazon Transcribe)**: Highly accurate (OpenAI GPT-4o WER ~2–3%, Google Chirp ~11% on benchmarks) and fast, with features like speaker diarization, punctuation, multi-language support. Paid services (sub-$0.01/minute). Good for production quality transcription and streaming.  
- **AssemblyAI, Deepgram, etc.**: Smaller providers with specialized features (call analytics, punctuation).  
- **Web Speech API**: Browser builtin, good for short dictation, but limited languages and accuracy.  
- **Runtime**: In-browser transcription is limited. Whisper.cpp (C++ compiled) can run on client with CPU/GPU (emulated via Emscripten or WASM). There are `whisper.cpp WASM` builds, but performance is limited. Likely not practical on pure JS.  
- **Benchmarks**: 2026 benchmarks show cloud ASR (GPT-4o) leading, Whisper lagging (15-16% WER for Whisper Large). For our use (informal speech, possibly multi-speaker), commercial APIs will outperform Whisper on noisy input.  
- **When to Use**:  
  - **Whisper (cloud)** for user-uploaded short audios when cost must be minimal.  
  - **Cloud ASR APIs** for anything production: meeting transcripts, noisy voice notes, etc. They handle streaming and diarization better.  
  - **Browser/desktop**: Possibly Web Speech API (Chrome only) for quick transcribe if user allows.  
- **When *Not* to Use**: Whisper on long recordings or when you need perfect accuracy on names, unless re-transcribing on server.  
- **Migration**: We can start with Whisper (maybe via OpenAI free tier) for Beta, then upgrade to cloud ASR for v1 or premium features.  

## Embeddings

- **Text Embeddings**: Map text into vectors for semantic search. Leading models include **OpenAI embeddings** (text-embedding-ada-002/003, etc; quality high, dimension 1536 or 4096), **Cohere embeddings**, and **Hugging Face Sentence Transformers** (e.g. `all-mpnet-base-v2`, `multi-qa-MiniLM`). OpenAI’s 2025/26 offering is dominant in accuracy.  
  - *Performance*: Typically hundreds of milliseconds per request on modern GPUs. For on-prem, models like `text-embedding-4bit` or distilBERT variants can run on CPU but slower.  
  - *Complexity*: Easy via API or libraries (OpenAI, Hugging Face Diffusers).  
  - *Offline*: Hugging Face models can run locally (need disk and memory).  
  - *Future*: Expect larger, more powerful embedding models, maybe multimodal (image+text).  
- **Image Embeddings**: CLIP (ViT-L/14) is standard. Google’s CLIP variant (ViT-G) or OpenCLIP. Also: **DINOv2**, **BEiT**.  
  - *Purpose*: Convert images to semantic vectors. Use for image search or combining with text.  
- **Specialized Embeddings**: Audio embeddings (Wav2Vec), video embeddings (POB: frames+CLIP). Possibly Multilingual and tabular embeddings exist.  
- **Benchmarks**: Various community leaderboards. Generally, pay-for-use models (OpenAI, Cohere) still outperform open-source on benchmarks (SMT analogy tasks).  
- **When to Use**: Always for building a vector index of content. Start with a small model for Beta (e.g. Ada or MiniLM), then scale quality for prod.  
- **Alternatives**: One-hot or TF-IDF (for baseline lexical search), hashing (SimHash), convolutional features for images (ResNet embeddings), but they are less semantic.  

## Vector Databases

- **Pinecone**: Managed cloud vector DB. Fully hosted, auto-scaling, supports billions of vectors. **Features**: Real-time indexing, metadata filters, etc. **Trade-offs**: Proprietary, cost (starts around $100/mo), but no ops. Good documentation.  
- **Chroma**: Open-source (MIT), lightweight. Embeds-per-run Python library with SQLite or on-disk storage. **Features**: Easy, supports metadata, Pythonic API. **Limits**: Single machine, not distributed. Good for prototyping and small teams.  
- **Weaviate**: Open-source (VectoQL). Supports vector + GraphQL hybrid searches, modules for text generation (OpenAI, Cohere) directly. **Features**: Schema-driven, natively hybrid search (vector+keyword). Good for complex knowledge graphs. Harder to self-host at scale, often used via managed cloud.  
- **Qdrant**: Open-source, Rust-based. Focus on high performance, payload filtering (vector + attribute filters). Offers REST/gRPC APIs. Good trade-off: no maintenance (self-hosted) and strong speed. Weaviate and Qdrant are often top choices for self-managed.  
- **Milvus**: Open-source, CNCF project. Distributed (supports sharding, clustering), GPU-accelerated. Built for massive scale (billions of vectors). **Use-case**: enterprise scale, AI services. More complex to setup.  
- **PgVector**: A PostgreSQL extension for vectors. If our stack already uses Postgres, this lets us keep one DB. Good for moderate size. Not as fast as a dedicated vector engine.  
- **Redis (RedisAI)**: In-memory vector search via Redis modules. Ultra-low-latency; integrates with existing Redis infrastructure. Limited by RAM unless using Redis on Flash. Useful for real-time, but more ops overhead.  
- **Others**: Amazon Kendra (AI search service), ElasticSearch with vector plugin (Lucene), OpenSearch, Elastic App Search.  
- **Benchmarks**: Usually HNSW index is default; recall/latency varies by implementation. Independent studies place Pinecone/Weaviate/Qdrant in top tier for speed/accuracy; Chroma is simpler but slower.  
- **When to Use**:  
  - **Beta**: Possibly no vector DB (just in-memory or SQLite-Vec) to avoid ops. If needed, Chroma or Qdrant self-hosted on a dev machine.  
  - **Prod v1**: If expecting modest scale, Qdrant or Weaviate on a VM cluster. If ease of ops is priority, Pinecone managed. Or Redis if we already have Redis infra.  
  - **100k – 1M users**: Likely need distributed vectors (Milvus or managed Pinecone); or multi-instance Qdrant/Weaviate. Prioritize reliability (multi-AZ, backups).  
- **Trends**: Hybrid search (combining vector and lexical) is standard (Weaviate has modules, MeiliSearch hybrid support). Many tools also support exact filtering on metadata (payloads).  

## Search Engines (Textual Search)

- **Elasticsearch/OpenSearch**: The classic distributed search engine (Apache Lucene backend). **Pros**: Scales to billions of docs, full-text with relevancy, aggregations. **Cons**: Complex config and maintenance. Resource-heavy. Requires dedicated servers or cloud (Elastic Cloud, AWS). Great for logs and enterprise search.  
- **MeiliSearch**: A modern Rust engine. **Pros**: Very fast out-of-box (<50ms queries), typo-tolerance, simple API, easy to setup. Offers hybrid search (semantic + lexical) via vector plugins. **Cons**: Newer, less community but growing. Limited features compared to ES (no advanced analytics).  
- **Typesense**: Rust-based like Meili. Built-in synonyms, facets. Good for small teams.  
- **SQLite FTS5 / Lunr.js**: For completely client-side, the browser can index text. E.g. [SQLite FTS5](https://sqlite.org/fts5.html) used via SQLite-WASM, or [Lunr.js](https://lunrjs.com/) in JavaScript. **Use-case**: small doc sets (tens of thousands). Low maintenance, offline. But not robust at scale.  
- **Bleve (Go)**, **Whoosh (Python)**: Libraries for full-text indexing, less popular now.  
- **Search Hybrid**: Combining keyword + semantic is becoming standard. E.g. Elastic now supports vector fields, Qdrant has BM25 plugin, Weaviate. Meili supports hybrid through one API.  
- **When to Use**:  
  - **Keyword search**: Meili for low ops, ES for enterprise scale.  
  - **Combined search**: If also doing semantic search, prefer vector DB with filtering or Meili’s hybrid.  
  - **Offline/in-browser**: SQLite FTS or simple JSON search for Beta.  
- **Limits**: If a search index is large (many docs), must run on backend. In extension, local search is limited by memory.  

## Knowledge Graphs

- **Concept**: A knowledge graph connects entities via relationships, capturing domain semantics. Can be implemented via property graphs (nodes/edges with properties) or RDF triples (subject-predicate-object with ontologies).  
- **Property Graphs**: e.g. **Neo4j** (ACID graph DB), **ArangoDB** (multi-model), **JanusGraph**, **TigerGraph**. Support languages like Cypher, Gremlin. Good for social networks, recommendation engines.  
- **RDF/Triple Stores**: e.g. **Apache Jena Fuseki**, **Blazegraph**, **GraphDB** (Ontotext). Use RDF and SPARQL. RDF supports rich semantics/ontologies but is more complex.  
- **Query Languages**: Cypher/GQL (property graphs), SPARQL (RDF). GraphQL (generic API) isn’t a graph storage itself, but can front-end a graph.  
- **Integration with Vector DB**: Some products (Weaviate) blend vector + graph schemas, labeling them as “knowledge graphs” for RAG applications.  
- **Benchmarks/Scalability**: Generally, graph DBs handle billions of edges when scaled (e.g. Neo4j Enterprise). RDF stores are more niche, slower for large data.  
- **When to Use**: If you have rich, interlinked metadata (e.g. people, topics, citations) and need complex traversal or reasoning. Possibly later in pipeline (after we have structured content, we could build an internal knowledge graph for inference).  
- **When *Not* to Use**: Early stages; too much overhead. Most RAG/Q&A apps do not need a formal KG. RDF ontology work has heavy upfront cost.  

## Document Parsing

- **Purpose**: Extract structured data from documents (PDFs, Office files, HTML).  
- **Tools**:  
  - **Apache Tika**: Java library to detect and extract text/metadata from many formats (PDF, Word, HTML). Good general tool.  
  - **PDF Parsers**: 
    - *pdf.js* (Mozilla) – renders PDF, can extract text. 
    - *PyMuPDF / MuPDF*, *PDFBox*, *PDFMiner* – server-side libraries for PDF text + layout.  
    - *docx / pptx libraries* – parse Word/PowerPoint.  
  - **Unstructured Libraries**: [LangChain’s loaders](https://python.langchain.com/en/latest/modules/indexes/document_loaders.html) or [LlamaIndex](https://gpt-index.readthedocs.io/) have Python modules to load text from web pages, markdown, PDFs, etc.  
  - **Table Extractors**: *Camelot*, *Tabula* (Java/PDF tools) to get tables from PDFs. Google’s Document AI (form parser) also handles tables.  
  - **Layout Parsers**: *layoutparser*, *Donut (Document Understanding Transformer)* – ML models for segmenting document images into paragraphs, tables, figures. Useful when OCR is not enough.  
- **Complexity**: Parsing can be tricky (fonts, multi-column text). Usually a pipeline: detect file type (Tika), then apply specific parser.  
- **Benchmarks**: Accuracy varies by tool. Generally, open-source can extract most text but may misorder columns or miss complex formatting. Paid services (Google Document AI, Azure Form Recognizer) are better but require network.  
- **When to Use**: Always: when ingesting PDFs or web articles, use parsing to extract text and metadata. Tools like Tika or PDF.js do most work.  
- **When *Not* to Use**: If content is already plain text.  
- **Alternatives/Trends**: Some new LLM-based parsers like Google’s Summarize & QnA over PDF (DocAI), or GPT-4 TLDR of PDF (Beta API).  

## Layout Analysis

- **Purpose**: Understand the geometric layout of content (pages, columns, tables, headings).  
- **Tools**: 
  - **LayoutLM** (Microsoft/Hugging Face): Transformer that takes scanned doc images + OCR results to understand structure. Can identify tables, form fields. 
  - **Table OCR**: Camelot/Tabula for tabular data extraction. 
  - **Document AI**: Google’s APIs can identify form fields, tables, paragraphs.  
- **Use-case**: Improves OCR by feeding it document-specific segments. E.g. detect columns so text flows correctly.  
- **Complexity**: ML models or heuristic libraries; moderate setup (need models).  
- **When to Use**: With documents like books, papers, invoices where structure matters. For normal social media posts, not needed.  
- **Benchmark**: State-of-art models report F1-scores on table detection, etc.  

## Media Processing

- **Audio**: 
  - **FFmpeg**: Ubiquitous tool for audio conversion, splitting channels, resampling. 
  - **Librosa**: Python library for audio analysis (spectrograms). 
  - **Web Audio API**: In-browser decoding/encoding for short clips; limited.  
- **Images**: 
  - **ImageMagick / Sharp**: For resizing, format conversion. Sharp (Node) uses libvips for speed. In-browser: Canvas or [Jimp](https://www.npmjs.com/package/jimp). 
  - **OpenCV (WebAssembly)**: For advanced processing (edge detection, filtering). [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html) is sizable (~7MB) but usable for client-side transforms.  
- **Video**: 
  - **FFmpeg**: Key for converting formats, extracting frames (`ffmpeg -i input.mp4 output_%03d.png`). 
  - **FFmpeg.wasm**: Projects like [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) compile FFmpeg to WebAssembly (size ~25MB), enabling some in-browser processing.  
  - **WebCodecs API**: Browser-native codecs (video/audio encoding/decoding in JavaScript). Allows grabbing frames or encoding output. Not fully mature/portable yet.  
- **Performance**: FFmpeg on server is extremely fast (multi-threaded). In-browser tools are limited by WASM overhead.  
- **When to Use**: 
  - **Server/desktop**: Use FFmpeg for batch audio/video preprocessing (e.g., extract frames for OCR, extract audio for STT). 
  - **Browser**: Use lightweight image processing (canvas filters) and the WebCodecs API for small videos or screen capture (if user-driven).  
- **Future**: WebCodecs and WebGPU may enable more on-device processing.

## AI Orchestration and Workflow

- **Workflow Systems**: Tools for defining and running complex pipelines (data extraction → processing → model inference → storage).  
  - **Airflow / Apache NiFi**: Python/Java for data pipelines (ETL). Airflow for batch/cron jobs. Probably overkill for in-browser, but useful if backend workflows needed.  
  - **Kubeflow / MLFlow**: Focused on ML pipelines (training, experimentation). Overhead is high if only inference.  
  - **Ray / Dask**: Python frameworks for parallel tasks; Ray has [Ray Serve](https://docs.ray.io/en/latest/serve/) for model serving. Good for scalable compute.  
  - **Prefect / Argo Workflows**: Modern workflow engines (Python/Go), DAGs for tasks, retries, etc.  
  - **Temporal.io**: Durable workflows using code (SDKs in Go/Java/Python). Good for fault-tolerant pipelines (ACID-ish).  
  - **n8n / Node-RED**: Low-code workflow automation (JavaScript).  
- **AI-specific Frameworks**: 
  - **LangChain** (Python/JS): Orchestration of LLM calls and tools (agents). Good for building chatbots, agents that call models, search, etc..  
  - **LlamaIndex (GPT Index)**: Data ingestion and retrieval for LLMs, creating indices (vector+text) from corpora.  
  - **Haystack (deepset)**: Focus on document search pipelines (connectors, retrievers, readers).  
  - **LLM Flow (Grafana Labs)**: Newer pipeline tool for multi-step generation tasks.  
- **Performance & Complexity**: Most of these run on servers, not browsers (Ray has some JS). They add complexity (infrastructure) but manage retries, scaling, logging.  
- **When to Use**:  
  - For Beta/proof-of-concept, use simple orchestrations (JavaScript async queues, or small Python scripts).  
  - For Prod, adopt a robust workflow engine to handle retries (e.g. Temporal or Airflow on a small cluster). LLM frameworks (LangChain/Haystack) can structure our RAG logic.  
- **Future**: As AI matures, we expect more hosted orchestration (HuggingFace Inference Endpoints, Google Vertex pipelines).

## RAG and LLM Frameworks

- **LangChain**: Python/JS framework for building chains of LLM calls and integrations. Emphasizes agents (LLMs calling tools/APIs) and memory. Great for building complex LLM-driven apps with external APIs.  
- **LlamaIndex** (GPT Index): Python framework focused on feeding data into LLMs. Manages chunking, embedding, indexing, and RAG query pipeline. Good for structured data ingestion and retrieval.  
- **Haystack**: An open-source search+RAG framework (Python) by deepset. Provides pipelines combining OpenSearch/Elasticsearch, retriever models, and answer-generator LLMs. Emphasizes production-readiness (monitoring, REST API).  
- **Semantic Kernel**: Microsoft’s .NET SDK for building RAG apps with GPT, including vector search connectors.  
- **Pinecone SDK / Qdrant client / Chroma APIs**: Often used in combination with above frameworks for the RAG step.  
- **When to Use**: If needing a structured LLM app: use LangChain (flexible chaining), LlamaIndex (data ingestion focus), or Haystack (if we rely on Elastic/Opensearch + QA). Can also mix (LangChain agent for tooling + LlamaIndex for doc lookup).  
- **Differences**: LangChain for dynamic agent flows, LlamaIndex for static knowledge ingestion, Haystack for heavy doc search. All support basic RAG.  

## Recommended Technology Stack

We break the recommendations by stage, focusing on high quality and scalability (not just fastest to develop).

### Beta (Prototype to first users)  
- **Storage**: IndexedDB with OPFS fallback (using browser support detection). Use a JS library or our connector abstraction to write data. This covers JSON and smaller blobs. Implement an IndexedDB `IStorageEngine`.  
- **Media Files**: Store images/audio files in OPFS if available, else IndexedDB Blobs. Could also store thumbnails in IndexedDB for quick access.  
- **Crawler & Ingestion**: The existing MV3 extension for Instagram. Keep using the authenticated browser for capture (cookies) and use session storage.  
- **OCR**: Tesseract.js in an offscreen worker for images in posts (as advised by Staff Review). This needs local Tesseract WASM in the extension (free, client-side).  
- **Vision**: Defer heavy vision. Maybe use browser’s Canvas or basic ML (e.g., TensorFlow.js MobileNet for quick labels, or a small CLIP via ONNX). But likely skip for Beta.  
- **Speech**: Skip for Beta (or very simple: maybe use Whisper API for audio reels via backend if quick).  
- **Document Parsing**: Use browser DOM for HTML. For PDFs (if any), send to a backend or use pdf.js in-browser.  
- **Search**: Simple in-browser search: 
  - Use full-text on scraped text and OCR’d content. Possibly use SQLite FTS5 (with SQLite-WASM) or a library like [FlexSearch](https://github.com/nextapps-de/flexsearch) (fast JavaScript search). 
  - For semantics, maybe initially no vector search, just keyword.  
- **Embeddings & Vector Search**: Possibly none initially. Could store text blocks and implement keyword search. If time, could try embedding a few docs with MiniLM and do linear similarity in JS (slow).  
- **AI Models**: Use OpenAI (or similar) via API for any summarization or question answering on scraped content (if at all). Keep it minimal (maybe offload to backend).  
- **Controller**: The extension’s CrawlController (as now) + a new EnrichmentController pulling from IndexedDB by state (like Staff Review suggested).  
- **Why**: This uses no external servers except optional OpenAI API (which we can skip to avoid cost). It should run entirely in browser for Beta validation.  

### Production v1  
- **Storage**: Move to IndexedDB + OPFS (finalized implementation). Possibly SQLite-WASM via OPFS for complex queries if needed. Ensure all data persists (report incremental sync).  
- **Backend**: Introduce a lightweight backend (serverless functions or a small Node/Python service) for heavy tasks. This solves MV3 limitations.  
- **Media/Blobs**: If multi-device sync desired, push important media to a backend or cloud storage (e.g. S3) through user’s token. Otherwise store in OPFS and let extension manage locally.  
- **OCR & Vision**: Keep Tesseract for images. For best accuracy, offer an option to use a cloud OCR (Google/Azure) via backend for certain documents (if user opts in). Vision tasks (like summarizing an infographic) could use GPT-4v or Gemini via backend APIs.  
- **Speech**: Use Whisper (or Whisper API) to transcribe video audio for reels (if capturing video reels audio). Possibly Whisper API (cheap) or local Whisper.cpp if we use a desktop companion app. For immediate Prod, leveraging Whisper API or cloud services is easiest.  
- **Embeddings & Search**:  
  - Run an enrichment pipeline (outside browser) that takes each resource’s text blocks and runs them through an embedding model. Initially, use an off-the-shelf embedding (e.g. OpenAI or HuggingFace).  
  - Deploy a vector database: For a small team, **Chroma** or **Qdrant** on a single managed VM. Or a hosted Pinecone if budget allows. This enables semantic retrieval.  
  - For text search: use a dedicated engine. *Options*: 
    - If using Postgres on backend, add PGVector or Postgres full-text. 
    - Or run **MeiliSearch** (lightweight) for combined keyword + vector (as they plan hybrid soon).  
  - The extension could call a local HTTP API for search/RAG queries.  
- **RAG/LLM**: Build on LangChain or similar. For example, a question asked by user triggers: vector DB retrieval + GPT-4 prompt with context. Or use LlamaIndex pipeline.  
- **Architecture**: Split work: extension handles crawling+basic transform; backend orchestrates enrichment workers. Use `ResourceState` queue (EXTRACTED→HYDRATED→ENRICHED) to manage pipeline. The extension writes to IndexedDB and an on-disk file store (OPFS). The backend pulls from a durable store (maybe sync extension IndexedDB to server via periodic upload).  
- **Scaling**: Even for v1, design as if backend tasks will scale. Use containers or serverless with moderate capacity.  
- **Why**: This stage introduces backend compute while still preserving privacy (user data stays client until optional sync). It also separates ingestion from compute, easing MV3 limits.

### Scaling to 100K / 1M users  
- **Storage (Client)**: Same approach, but ensure extension is robust (handles large volumes). Might need to shard collection data (multiple IndexedDB DBs) or clear old data.  
- **Backend**:  
  - Move from serverless prototypes to more robust infra. e.g., Kubernetes or AWS ECS for the workers (OCR, embedding, LLM calls). Use GPU instances for Whisper and vision tasks.  
  - Blob storage: if syncing, use cloud buckets with CDN for any images/content.  
  - Vector DB: Upgrade to a clustered solution. For 100k+, consider **Weaviate or Milvus** cluster for high availability. For 1M+, strongly consider managed (Pinecone/Chroma Cloud) or self-managed Milvus with shard+replica.  
  - Search: Use Elasticsearch or multiple Meili instances behind a load balancer.  
- **Performance**: Cache embeddings for popular items; reuse search results. Use batch processing for heavy tasks.  
- **CDN & Caching**: Host static scraped data or mini-API content on CDN for low-latency retrieval. For example, once a post is crawled and enriched, its JSON could be cached.  
- **Offline Capability**: For truly offline use, rely on local extension; but for others, web app can fetch enriched resources. Provide mobile/desktop companion apps with local sync (PouchDB/CouchDB or CRDT for sync, if needed).  
- **Privacy**: On this scale, must ensure compliance (GDPR/etc). Process user content on server only if user consents (e.g. opt-in to cloud OCR). Anonymize any telemetry.  
- **Why**: At this scale, a distributed architecture is required. We choose proven infrastructure: container clusters, managed DBs. Data volumes justify investment.  

## Open Questions & Tradeoffs

- **Local vs Backend Compute**: Many decisions hinge on whether heavy tasks run on-device or in cloud. For OCR+basic NLP, we lean on the browser (Tesseract, simple NER) to preserve privacy and offline. For LLM/speech/vision, likely cloud or optional desktop app (if user installs one).  
- **Syncing Data**: If multiple devices/users must share, we need a sync layer (e.g. CouchDB or custom backend). Otherwise, treat each device’s store as independent.  
- **Vector DB Choice**: For on-device, SQLite-Vec could be explored. But large scales demand external DB. Pinecone vs Qdrant vs Weaviate will be chosen by cost/ops.  
- **AA (Architectural)**: Might consider a P2P model for heavy tasks (like federated learning), but complexity is high. Probably skip for now.  

## Summary

We will adopt a modular ingestion/enrichment pipeline. **Ingestion** (extension, browser): crawling + capture bytes (OPFS) + initial parse + persist resource with media blob references. **Enrichment** (worker processes, on device or server): OCR, transcription, embedding, knowledge extraction, and indexing. Each stage is a self-contained component, talking via shared storage and state flags. 

Key decisions:  
- **Media Capture Ingest**: Do it **inside** the authenticated browser crawl.  
- **OCR**: Immediate Beta focus, in extension (MV3 Offscreen Worker) with Tesseract.  
- **Database**: Use IndexedDB + OPFS in extension for persistence (durable), as Beta baseline.  
- **Workers**: Offload heavy tasks to either an embedded worker or eventually a backend, using the processing state machine (ResourceState) to coordinate.  

This approach aligns with our architecture principles: connectors (extension) do only platform-specific work; the engine (enrichment pipeline) is platform-agnostic and replaceable.  

**Engineering Principles**: Begin with simplest possible solutions (Tesseract.js, IndexedDB). Add complexity (vector DB, LLM) only when value is proven. Keep ingestion vs enrichment separate (just as we did with `IResource` and its `media.blob`). Use well-supported technologies (SQLite-WASM, Weaviate, etc.) to minimize custom work.  

**Competitive Edge**: We aim to combine the best of content capture (via our crawler) with deep semantic extraction (OCR, LLMs, vector search). If launched today, we differentiate by *embedding knowledge extraction directly into the workflow* (OCR on educational images, lecture transcripts, code snippets) – not just bookmarking. As others (Readwise, Obsidian) largely index text, our ability to parse and search image/video content (via OCR/vision) will be a key selling point. 

## References

- “LocalStorage vs. IndexedDB vs. Cookies vs. OPFS vs. WASM-SQLite” (RxDB)  
- “The Current State of SQLite Persistence on the Web: May 2026” (PowerSync blog)  
- “sqlite-vec: A vector search SQLite extension”  
- PGlite documentation (Electric-sql)  
- DuckDB-WASM README  
- MDN: “Origin private file system (OPFS)”  
- Analysis of OCR engines (Tesseract vs Vision)  
- Vector DB comparison (Ozkaya, 2024)  
- Meilisearch blog vs Elasticsearch/Qdrant (2025)  
- ASR 2026 comparison (Gladia)  
- AI frameworks (Milvus blog)  
- Neo4j RDF vs Property Graph blog

