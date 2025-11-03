
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
        shared.directoryFiles = execRes;
        shared.dataDir = dataDir;  
        console.log('ListDirectoryNode: Found files:', shared.directoryFiles);
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
    };
    filterPdfNode.postAsync = async (shared, prepRes, execRes) => {
        shared.filteredPdfFiles = execRes.map(file => shared.dataDir + '/' + file);
        console.log('FilterPdfNode: Filtered and absolute paths:', shared.filteredPdfFiles);
    };

    // 3. Main Iterator Node (iterates over PDFs)
    const iteratorNode = new IteratorNode(); 
    iteratorNode.prepAsync = async (shared, prepRes) => {
        // The items for iteration are in shared.filteredPdfFiles
        console.log('Main IteratorNode: Preparing to iterate over:', shared.filteredPdfFiles.length, 'PDFs');
        iteratorNode.setParams({
            items: shared.filteredPdfFiles,
            flow: subFlow,
        });
    };
    iteratorNode.postAsync = async (shared, prepRes, execRes) => {
        console.log('Main IteratorNode: All PDFs processed.');
    };

    // 4. Sub-flow for processing each PDF and its chunks
    const subFlow = new AsyncFlow();

    // 5. PDF Processor Node (within subFlow)
    const pdfProcessorNode = new PDFProcessorNode();
    pdfProcessorNode.prepAsync = async (shared, prepRes) => {
        console.log("PDFProcessorNode: Preparing to process:", shared.item);
        pdfProcessorNode.setParams({ filePath: shared.item, action: 'extract_text' });
    };
    pdfProcessorNode.postAsync = async (shared, prepRes, execRes) => {
        shared.fullPdfText = execRes.text; 
        shared.originalFileId = shared.item; 
        console.log('PDFProcessorNode: Extracted full text length:', shared.fullPdfText.length);
    };

    // NEW: 6. Text Chunking Node (Custom Node)
    const textChunkingNode = new TextChunkingNode(); 
    textChunkingNode.prepAsync = async (shared, prepRes) => {
        textChunkingNode.setParams({
            fullText: shared.fullPdfText, 
            minChunkLength: 50 
        });
        console.log('TextChunkingNode: Preparing to chunk text.');
    };
    textChunkingNode.postAsync = async (shared, prepRes, execRes) => {
        shared.textChunks = execRes; // execRes will be an array of chunks
        console.log('TextChunkingNode: Generated', shared.textChunks.length, 'chunks.');
    };

    // NEW: 7. Sub-sub-flow for processing each chunk (embedding and storing)
    const chunkProcessingSubFlow = new AsyncFlow();

    const semanticMemoryNodeForChunk = new SemanticMemoryNode();
    semanticMemoryNodeForChunk.prepAsync = async (shared, prepRes) => {
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
    };
    semanticMemoryNodeForChunk.postAsync = async (shared, prepRes, execRes) => {
        console.log('SemanticMemoryNode: Chunk stored:', shared.item.content.substring(0, 50) + '...');
    };

    chunkProcessingSubFlow.start(semanticMemoryNodeForChunk);

    // NEW: 8. Iterator for Chunks
    const chunkIteratorNode = new IteratorNode();
    chunkIteratorNode.prepAsync = async (shared, prepRes) => {
        const itemsForChunkIterator = shared.textChunks.map((chunk, index) => ({
            content: chunk, // The actual chunk content
            originalFileId: shared.originalFileId,
            chunkIndex: index
        }));
        chunkIteratorNode.setParams({ // <--- Set params here
            items: itemsForChunkIterator,
            flow: chunkProcessingSubFlow,
        });
    };
    chunkIteratorNode.postAsync = async (shared, prepRes, execRes) => {
        console.log('ChunkIteratorNode: All chunks processed for current PDF.');
    };

    // Chain nodes within the main subFlow (for each PDF)
    subFlow.start(pdfProcessorNode)
        .next(textChunkingNode)
        .next(chunkIteratorNode); 

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
        let dialogTitle = "Qflow Query"; 

        if (shared.llmResponse) {
            let llmAnswer = shared.llmResponse;
            // Replace all backslashes with double backslashes Remove markdown bolding (**)
            llmAnswer = llmAnswer.replace(/\*\*(.*?)\*\*/g, '$1');
            // Remove all double quotes from the LLM answer
            llmAnswer = llmAnswer.replace(/"/g, '');
            // Escape backslashes (still good practice)
            llmAnswer = llmAnswer.replace(/\\/g, '');

            // Extract the first line for the dialog title
            const firstNewlineIndex = llmAnswer.indexOf('\n');
            if (firstNewlineIndex !== -1) {
                dialogTitle = llmAnswer.substring(0, firstNewlineIndex).trim();
                llmAnswer = llmAnswer.substring(firstNewlineIndex + 1).trim(); 
            } else {
                // If no newline, the whole answer is the title (or a very short answer)
                dialogTitle = llmAnswer.trim();
                llmAnswer = ''; 
            }

            promptMessage = `${llmAnswer}\n\nEnter your next query (or 'exit' to quit):`;
        }

        interactiveInputNode.setParams({
            prompt: promptMessage,
            defaultValue: defaultValue,
            title: dialogTitle
        });
    };
    interactiveInputNode.postAsync = async (shared, prepRes, execRes) => {
        shared.interactiveInputResult = execRes; // Store user's raw input
        console.log('InteractiveInputNode: User entered next query:', shared.interactiveInputResult);

        // Check for exit conditions here
        if (execRes === null || execRes.toLowerCase() === '@exit' || execRes.toLowerCase() === '@quit') {
            return 'user_exit'; // Return a specific action to terminate the flow
        }
        delete shared.llmResponse;
    };

    // 2. Set Query Node (TransformNode)
    const setQueryNode = new TransformNode();
    setQueryNode.prepAsync = async (shared, prepRes) => {
        setQueryNode.setParams({
            input: shared.interactiveInputResult,
            transformFunction: `(data) => {
                console.log('SetQueryNode (TransformNode): Transforming raw input:', data);
                return { query: data }; // Return an object with 'query' key
            }`
        });
    };
    setQueryNode.postAsync = async (shared, prepRes, execRes) => {
        shared.queryForSemanticMemory = execRes; 
        //console.log('SetQueryNode: Query for semantic memory:', shared.queryForSemanticMemory);
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
    };
    semanticMemoryNode.postAsync = async (shared, prepRes, execRes) => {
        shared.semanticMemoryResult = execRes; 
        console.log('SemanticMemoryNode: Retrieved memories count:', shared.semanticMemoryResult.length);
    };

    // 4. Transform Node (for LLM prompt)
    const transformNode = new TransformNode();
    transformNode.prepAsync = async (shared, prepRes) => {
        transformNode.setParams({
            input: {
                semanticMemoryResult: shared.semanticMemoryResult,
                interactiveInputResult: shared.interactiveInputResult
            },
            transformFunction: `(data) => { const context = data.semanticMemoryResult.map(doc => doc.content).join(' '); const question = data.interactiveInputResult; return 'Context: ' + context + ' Question: ' + question + ' Answer:'; }`
        });
    };
    transformNode.postAsync = async (shared, prepRes, execRes) => {
        shared.llmPrompt = execRes; 
        shared.llmPrompt += '\n\nPS: Return a cleanly formatted answer thats ready to be displayed in a dialog box like zenity or kdialog easily and clear with emojis and no markdown, remember i use first line as title!'; // Use the formatted prompt; // Store the formatted LLM prompt
        //console.log('TransformNode (LLM Prompt): Generated LLM prompt:', shared.llmPrompt.substring(0, 200) + '...');
    };

    // 5. DeepSeek LLM Node
    const llmNode = new DeepSeekLLMNode();
    llmNode.preparePrompt = (shared) => { 
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
        shared.llmResponse = execRes; 
        //console.log('DeepSeekLLMNode: LLM Response received.');
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
