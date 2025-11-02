
import { AsyncFlow  } from '@fractal-solutions/qflow';
import {
    ListDirectoryNode,
    PDFProcessorNode,
    SemanticMemoryNode,
    InteractiveInputNode,
    DeepSeekLLMNode,
    IteratorNode,
    TransformNode, // Moved TransformNode here
} from '@fractal-solutions/qflow/nodes';

export function createIndexingWorkflow(dataDir) {
    // 1. List Directory Node
    const listDirectoryNode = new ListDirectoryNode();
    listDirectoryNode.setParams({
        directoryPath: dataDir,
    });
    listDirectoryNode.postAsync = async (shared, prepRes, execRes) => {
        shared.directoryFiles = execRes; // Store file names
        shared.dataDir = dataDir;       // Store dataDir for later use
        //console.log('ListDirectoryNode: Found files:', shared.directoryFiles);
        return 'default'; // Explicitly return 'default' to continue flow
    };

    // 2. Filter PDF Node (TransformNode)
    const filterPdfNode = new TransformNode();
    filterPdfNode.prepAsync = async (shared, prepRes) => {
        filterPdfNode.setParams({
            input: shared.directoryFiles, // Explicitly set the input for the TransformNode
            transformFunction: `(data) => { // transformFunction only takes 'data'
                console.log('TransformNode (filterPdfNode): Filtering raw data:', data);
                return data.filter(file => file.endsWith('.pdf'));
            }`
        });
        return prepRes;
    };
    filterPdfNode.postAsync = async (shared, prepRes, execRes) => {
        // execRes here is the array of filtered PDF filenames (e.g., ['file1.pdf', 'file2.pdf'])
        // We need to map these to absolute paths using shared.dataDir
        shared.filteredPdfFiles = execRes.map(file => shared.dataDir + '/' + file);
        //console.log('FilterPdfNode: Filtered and absolute paths:', shared.filteredPdfFiles);
        return 'default'; // Explicitly return 'default'
    };

    // 3. Sub-flow for processing each PDF
    const subFlow = new AsyncFlow();

    // 4. PDF Processor Node (within subFlow)
    const pdfProcessorNode = new PDFProcessorNode();
    pdfProcessorNode.prepAsync = async (shared, prepRes) => {
        //console.log("PDFProcessorNode: Preparing to process:", shared.item);
        //console.log("PDFProcessorNode: prepRes:", prepRes); // Add this log
        pdfProcessorNode.setParams({ filePath: shared.item, action: 'extract_text' });
        return prepRes; // Return prepRes
    };
    pdfProcessorNode.postAsync = async (shared, prepRes, execRes) => {
        //console.log('PDFProcessorNode: execRes from PDFProcessorNode:', execRes);
        shared.pdfTextContent = execRes.text; // Store ONLY the extracted text
        //console.log('PDFProcessorNode: Extracted text length:', shared.pdfTextContent ? shared.pdfTextContent.length : 'undefined (content is null/undefined)');
        return 'default';
    };

    // 5. Semantic Memory Node (within subFlow)
    const semanticMemoryNode = new SemanticMemoryNode();
    semanticMemoryNode.prepAsync = async (shared, prepRes) => {
        if (!shared.pdfTextContent) {
            throw new Error("SemanticMemoryNode: No PDF text content found to store.");
        }
        const memoryId = shared.item; // Use the file path as a unique ID
        semanticMemoryNode.setParams({
            action: 'store',
            content: shared.pdfTextContent,
            id: memoryId,
            metadata: { source: shared.item } // Add metadata for traceability
        });
        //console.log('SemanticMemoryNode: Storing memory for:', shared.item);
        return prepRes; // Return prepRes
    };
    semanticMemoryNode.postAsync = async (shared, prepRes, execRes) => {
        //console.log('SemanticMemoryNode: Memory stored for:', shared.item);
        return 'default'; // Explicitly return 'default'
    };

    // Chain nodes within the subFlow
    subFlow.start(pdfProcessorNode).next(semanticMemoryNode);

    // 6. Iterator Node
    const iteratorNode = new IteratorNode();
    iteratorNode.prepAsync = async (shared, prepRes) => {
        // The items for iteration are in shared.filteredPdfFiles
        //console.log('IteratorNode: Preparing to iterate over:', shared.filteredPdfFiles.length, 'items');
        iteratorNode.setParams({
            items: shared.filteredPdfFiles,
            flow: subFlow,
        });
        return prepRes; // Return prepRes
    };
    iteratorNode.postAsync = async (shared, prepRes, execRes) => {
        //console.log('IteratorNode: Iteration completed.');
        return 'default'; // Explicitly return 'default'
    };

    // Main Indexing Flow
    const indexingFlow = new AsyncFlow();
    indexingFlow.start(listDirectoryNode)
        .next(filterPdfNode)
        .next(iteratorNode);

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
        //console.log('InteractiveInputNode: User input:', shared.interactiveInputResult);
        // Clear llmResponse after displaying it, so it doesn't show up again if no new LLM call is made
        delete shared.llmResponse;
        return 'default'; // Explicitly return 'default'
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
            topK: 3,
        });
        //console.log('SemanticMemoryNode: Retrieving memories for query:', shared.queryForSemanticMemory.query);
        return prepRes;
    };
    semanticMemoryNode.postAsync = async (shared, prepRes, execRes) => {
        shared.semanticMemoryResult = execRes; // Store retrieved documents
        //console.log('SemanticMemoryNode: Retrieved memories count:', shared.semanticMemoryResult.length);
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
        shared.llmPrompt += '\n\nPS: Return a cleanly formatted answer thats ready to be displayed in a dialog box like zenity or kdialog easily and clear with emojis and no markdown'; // Use the formatted prompt; // Store the formatted LLM prompt
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
    queryingFlow.start(interactiveInputNode) // Start with the interactive input node
        .next(setQueryNode)
        .next(semanticMemoryNode)
        .next(transformNode)
        .next(llmNode)
        .next(interactiveInputNode); // <--- Chain back to the interactiveInputNode for the next round

    return queryingFlow;
}
