# rage-pdf: RAG-powered PDF Q&A System

This project implements a Retrieval-Augmented Generation (RAG) system that allows you to ask questions about any PDF documents placed in its `data/` directory. It processes these PDFs, extracts their content, chunks them into manageable pieces, and stores them as semantic memories. When you ask a question, it retrieves relevant information from these memories and uses a Large Language Model (LLM) to generate an answer.

**Key Features:**
*   **PDF Ingestion:** Automatically processes PDF files found in the `data/` directory.
*   **Semantic Memory:** Chunks PDF content and stores embeddings for efficient retrieval of relevant information.
*   **Interactive Q&A:** Engage in a conversational Q&A with your documents via an interactive dialog. Type `@exit` or `@quit` to end the session.
*   **LLM Powered:** Utilizes the DeepSeek API for generating responses. The system is designed to be easily refactored to integrate with any other LLM API (e.g., OpenAI, Gemini, Ollama) by modifying the `DeepSeekLLMNode` or introducing a new LLM node.

**Current Configuration:**
*   **LLM Provider:** DeepSeek API. Ensure your `DEEPSEEK_API_KEY` is set in your `.env` file.
*   **Embedding Model:** `nomic-embed-text` via Ollama. Ensure Ollama is running (`ollama serve`) and the model is pulled (`ollama pull nomic-embed-text`).
*   **PDF Processing:** Requires `poppler-utils` to be installed on your system.

To install dependencies:

```bash
bun install
```

To run:

```bash
bun src/index.js
```

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
