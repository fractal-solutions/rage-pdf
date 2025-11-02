import { AsyncNode } from '@fractal-solutions/qflow';

export class TextChunkingNode extends AsyncNode {
    constructor(maxRetries = 1, wait = 0) {
        super(maxRetries, wait);
    }

    async execAsync(prepRes, shared) {
        const { fullText, minChunkLength = 50 } = this.params;

        if (!fullText) {
            throw new Error('TextChunkingNode requires `fullText` parameter.');
        }

        // Basic chunking by double newline (paragraph breaks)
        let paragraphs = fullText.split('\n\n').filter(p => p.trim().length > 0);

        // Filter out very short chunks
        let chunks = paragraphs.filter(p => p.length > minChunkLength);

        console.log('TextChunkingNode: Generated', chunks.length, 'chunks.');
        return chunks; // Return an array of chunks
    }

    async postAsync(shared, prepRes, execRes) {
        shared.textChunks = execRes; // Store the array of chunks
        return 'default';
    }
}
