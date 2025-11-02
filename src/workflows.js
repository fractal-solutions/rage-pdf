
import { AsyncFlow  } from '@fractal-solutions/qflow';
import {
    ListDirectoryNode,
    PDFProcessorNode,
    SemanticMemoryNode,
    InteractiveInputNode,
    DeepSeekLLMNode,
    IteratorNode,
    TransformNode,
} from '@fractal-solutions/qflow/nodes';
import { TextChunkingNode } from './nodes/TextChunkingNode'; 

export function createIndexingWorkflow(dataDir) {
    // 1. List Directory Node
    const listDirectoryNode = new ListDirectoryNode();
    listDirectoryNode.setParams({
        directoryPath: dataDir,
    });
    listDirectoryNode.postAsync = async (shared, prepRes, execRes) => {
        shared.directoryFiles = execRes; // Store file names
        shared.dataDir = dataDir;       // Store dataDir for later use
        console.log('ListDirectoryNode: Found files:', shared.directoryFiles);
        return 'default'; // Explicitly return 'default' to continue flow
    };

    // 2. Filter PDF Node (TransformNode)
    const filterPdfNode = new TransformNode();
    filterPdfNode.prepAsync = async (shared, prepRes) => {
        filterPdfNode.setParams({
            input: shared.directoryFiles,
            transformFunction: `(data) => {
                console.log('TransformNode (filterPdfNode): Filtering raw data:', data);
                return data.filter(file => file.endsWith('.pdf'));
            }`
        });
        return prepRes;
    };
    filterPdfNode.postAsync = async (shared, prepRes, execRes) => {
        shared.filteredPdfFiles = execRes.map(file => shared.dataDir + '/' + file);
        console.log('FilterPdfNode: Filtered and absolute paths:', shared.filteredPdfFiles);
        return 'default';
    };

    // 3. Main Iterator Node (iterates over PDFs)
    const iteratorNode = new IteratorNode(); // Define it here
    iteratorNode.prepAsync = async (shared, prepRes) => {
        // The items for iteration are in shared.filteredPdfFiles
        console.log('Main IteratorNode: Preparing to iterate over:', shared.filteredPdfFiles.length, 'PDFs');
        iteratorNode.setParams({
            items: shared.filteredPdfFiles,
            flow: subFlow, // This subFlow processes each PDF and its chunks
        });
        return prepRes; // Return prepRes
    };
    iteratorNode.postAsync = async (shared, prepRes, execRes) => {
        console.log('Main IteratorNode: All PDFs processed.');
        return 'default'; // Explicitly return 'default'
    };

    // 4. Sub-flow for processing each PDF and its chunks
    const subFlow = new AsyncFlow();

    // 5. PDF Processor Node (within subFlow)
    const pdfProcessorNode = new PDFProcessorNode();
    pdfProcessorNode.prepAsync = async (shared, prepRes) => {
        console.log("PDFProcessorNode: Preparing to process:", shared.item);
        pdfProcessorNode.setParams({ filePath: shared.item, action: 'extract_text' });
        return prepRes; // Return prepRes
    };
    pdfProcessorNode.postAsync = async (shared, prepRes, execRes) => {
        shared.fullPdfText = execRes.text; // Store the full extracted text
        shared.originalFileId = shared.item; // Store the original file path for metadata
        console.log('PDFProcessorNode: Extracted full text length:', shared.fullPdfText.length);
        return 'default'; // Explicitly return 'default'
    };

    // NEW: 6. Text Chunking Node (Custom Node)
    const textChunkingNode = new TextChunkingNode(); // Use our custom node
    textChunkingNode.prepAsync = async (shared, prepRes) => {
        textChunkingNode.setParams({
            fullText: shared.fullPdfText, // Pass fullText as a parameter
            minChunkLength: 50 // Optional: configure min chunk length
        });
        console.log('TextChunkingNode: Preparing to chunk text.');
        return prepRes;
    };
    textChunkingNode.postAsync = async (shared, prepRes, execRes) => {
        shared.textChunks = execRes; // execRes will be an array of chunks
        console.log('TextChunkingNode: Generated', shared.textChunks.length, 'chunks.');
        return 'default';
    };

    // NEW: 7. Sub-sub-flow for processing each chunk (embedding and storing)
    const chunkProcessingSubFlow = new AsyncFlow();

    const semanticMemoryNodeForChunk = new SemanticMemoryNode();
    semanticMemoryNodeForChunk.prepAsync = async (shared, prepRes) => {
        // shared.item here will be the object { content: chunk, originalFileId: ..., chunkIndex: ... }
        if (!shared.item || !shared.item.content) {
            throw new Error("SemanticMemoryNode: No chunk content found to store.");
        }
        const chunkContent = shared.item.content;
        const originalFileId = shared.item.originalFileId;
        const chunkIndex = shared.item.chunkIndex;
        const memoryId = `${originalFileId}_chunk_${chunkIndex}`;

        semanticMemoryNodeForChunk.setParams({
            action: 'store',
            content: chunkContent, // The individual chunk content
            id: memoryId,
            metadata: { source: originalFileId, chunkIndex: chunkIndex }
        });
        console.log('SemanticMemoryNode: Storing chunk for:', originalFileId, 'index:', chunkIndex);
        return prepRes;
    };
    semanticMemoryNodeForChunk.postAsync = async (shared, prepRes, execRes) => {
        console.log('SemanticMemoryNode: Chunk stored:', shared.item.content.substring(0, 50) + '...');
        return 'default';
    };

    chunkProcessingSubFlow.start(semanticMemoryNodeForChunk);

    // NEW: 8. Iterator for Chunks
    const chunkIteratorNode = new IteratorNode();
    chunkIteratorNode.prepAsync = async (shared, prepRes) => {
        // This iterator will iterate over shared.textChunks
        // Create items with metadata for the sub-sub-flow
        const itemsForChunkIterator = shared.textChunks.map((chunk, index) => ({
            content: chunk, // The actual chunk content
            originalFileId: shared.originalFileId,
            chunkIndex: index
        }));
        chunkIteratorNode.setParams({ // <--- Set params here
            items: itemsForChunkIterator,
            flow: chunkProcessingSubFlow,
        });
        return prepRes; // Return prepRes
    };
    chunkIteratorNode.postAsync = async (shared, prepRes, execRes) => {
        console.log('ChunkIteratorNode: All chunks processed for current PDF.');
        return 'default';
    };

    // Chain nodes within the main subFlow (for each PDF)
    subFlow.start(pdfProcessorNode)
        .next(textChunkingNode)
        .next(chunkIteratorNode); // Iterate over chunks of this PDF

    // Main Indexing Flow
    const indexingFlow = new AsyncFlow();
    indexingFlow.start(listDirectoryNode)
        .next(filterPdfNode)
        .next(iteratorNode); // This iterator now runs the modified subFlow for each PDF

    return indexingFlow;
}

export function createQueryingWorkflow() {
    // 1. Interactive Input Node (Modified to display answer and ask next question)
    const interactiveInputNode = new InteractiveInputNode();
    interactiveInputNode.prepAsync = async (shared, prepRes) => {
        let promptMessage = 'Enter your query: ';
        let defaultValue = '';
        let dialogTitle = "Qflow Query"; // Declare dialogTitle here

        if (shared.llmResponse) {
            let llmAnswer = shared.llmResponse;
            // Replace all backslashes with double backslashes
            // Remove markdown bolding (**)
            llmAnswer = llmAnswer.replace(/\*\*(.*?)\*\*/g, '$1');
            // Remove all double quotes from the LLM answer
            llmAnswer = llmAnswer.replace(/"/g, '');
            // Escape backslashes (still good practice)
            llmAnswer = llmAnswer.replace(/\\/g, '');

            // Extract the first line for the dialog title
            const firstNewlineIndex = llmAnswer.indexOf('\n'); // Use '\n' for literal newline
            if (firstNewlineIndex !== -1) {
                dialogTitle = llmAnswer.substring(0, firstNewlineIndex).trim();
                llmAnswer = llmAnswer.substring(firstNewlineIndex + 1).trim(); // Remove the first line from the answer
            } else {
                // If no newline, the whole answer is the title (or a very short answer)
                dialogTitle = llmAnswer.trim();
                llmAnswer = ''; // Clear the answer if it's all title
            }

            promptMessage = `${llmAnswer}\n\nEnter your next query (or 'exit' to quit):`;
        }

        interactiveInputNode.setParams({
            prompt: promptMessage,
            defaultValue: defaultValue,
            title: dialogTitle
        });
        return prepRes;
    };
    interactiveInputNode.postAsync = async (shared, prepRes, execRes) => {
        shared.interactiveInputResult = execRes; // Store user's raw input
        console.log('InteractiveInputNode: User entered next query:', shared.interactiveInputResult);

        // Check for exit conditions here
        if (execRes === null || execRes.toLowerCase() === '@exit' || execRes.toLowerCase() === '@quit') {
            return 'user_exit'; // Return a specific action to terminate the flow
        }

        delete shared.llmResponse;
        return 'default';
    };

    // 2. Set Query Node (TransformNode)
    const setQueryNode = new TransformNode();
    setQueryNode.prepAsync = async (shared, prepRes) => {
        setQueryNode.setParams({
            input: shared.interactiveInputResult, // Input is the user's raw query
            transformFunction: `(data) => {
                console.log('SetQueryNode (TransformNode): Transforming raw input:', data);
                return { query: data }; // Return an object with 'query' key
            }`
        });
        return prepRes;
    };
    setQueryNode.postAsync = async (shared, prepRes, execRes) => {
        shared.queryForSemanticMemory = execRes; // Store the formatted query object
        //console.log('SetQueryNode: Query for semantic memory:', shared.queryForSemanticMemory);
        return 'default'; // Explicitly return 'default'
    };

    // 3. Semantic Memory Node
    const semanticMemoryNode = new SemanticMemoryNode();
    semanticMemoryNode.prepAsync = async (shared, prepRes) => {
        if (!shared.queryForSemanticMemory || !shared.queryForSemanticMemory.query) {
            throw new Error("SemanticMemoryNode: No query found for retrieval.");
        }
        semanticMemoryNode.setParams({
            action: 'retrieve',
            query: shared.queryForSemanticMemory.query,
            topK: 20,
        });
        console.log('SemanticMemoryNode: Retrieving memories for query:', shared.queryForSemanticMemory.query);
        return prepRes;
    };
    semanticMemoryNode.postAsync = async (shared, prepRes, execRes) => {
        shared.semanticMemoryResult = execRes; // Store retrieved documents
        console.log('SemanticMemoryNode: Retrieved memories count:', shared.semanticMemoryResult.length);
        return 'default'; // Explicitly return 'default'
    };

    // 4. Transform Node (for LLM prompt)
    const transformNode = new TransformNode();
    transformNode.prepAsync = async (shared, prepRes) => {
        transformNode.setParams({
            // Input for this transform node needs both retrieved context and original user query
            input: {
                semanticMemoryResult: shared.semanticMemoryResult,
                interactiveInputResult: shared.interactiveInputResult
            },
            transformFunction: `(data) => { const context = data.semanticMemoryResult.map(doc => doc.content).join(' '); const question = data.interactiveInputResult; return 'Context: ' + context + ' Question: ' + question + ' Answer:'; }`
        });
        return prepRes;
    };
    transformNode.postAsync = async (shared, prepRes, execRes) => {
        shared.llmPrompt = execRes; 
        shared.llmPrompt += '\n\nPS: Return a cleanly formatted answer thats ready to be displayed in a dialog box like zenity or kdialog easily and clear with emojis and no markdown, remember i use first line as title!'; // Use the formatted prompt; // Store the formatted LLM prompt
        //console.log('TransformNode (LLM Prompt): Generated LLM prompt:', shared.llmPrompt.substring(0, 200) + '...');
        return 'default'; // Explicitly return 'default'
    };

    // 5. DeepSeek LLM Node
    const llmNode = new DeepSeekLLMNode();
    llmNode.preparePrompt = (shared) => { // Implement preparePrompt directly on the instance
        if (!process.env.DEEPSEEK_API_KEY) {
            throw new Error("DeepSeekLLMNode: DEEPSEEK_API_KEY is not set in environment variables.");
        }
        llmNode.setParams({
            apiKey: process.env.DEEPSEEK_API_KEY,
            prompt: shared.llmPrompt, 
        });
        //console.log('DeepSeekLLMNode: Prompt prepared.');
    };
    llmNode.postAsync = async (shared, prepRes, execRes) => {
        shared.llmResponse = execRes; // Store LLM's response
        //console.log('DeepSeekLLMNode: LLM Response received.');
        return 'default'; // Explicitly return 'default'
    };

    // Querying Flow Chaining
    const queryingFlow = new AsyncFlow();
    queryingFlow.start(interactiveInputNode)
        .next(setQueryNode, 'default') // Proceed to setQueryNode on 'default' action
        .next(null, 'user_exit'); // Terminate flow if 'user_exit' action is returned
        setQueryNode.next(semanticMemoryNode)
        .next(transformNode)
        .next(llmNode)
        .next(interactiveInputNode); // Loop back to interactiveInputNode

    return queryingFlow;
}
