
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
        console.log('ListDirectoryNode: Found files:', shared.directoryFiles);
        return 'default'; // Explicitly return 'default' to continue flow
    };

    // 2. Filter PDF Node (TransformNode)
    const filterPdfNode = new TransformNode();
    filterPdfNode.prepAsync = async (shared, prepRes) => {
        filterPdfNode.setParams({
            transformFunction: `(data) => {
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
        console.log('FilterPdfNode: Filtered and absolute paths:', shared.filteredPdfFiles);
        return 'default'; // Explicitly return 'default'
    };

    // 3. Sub-flow for processing each PDF
    const subFlow = new AsyncFlow();

    // 4. PDF Processor Node (within subFlow)
    const pdfProcessorNode = new PDFProcessorNode();
    pdfProcessorNode.prepAsync = async (shared, prepRes) => {
        console.log("PDFProcessorNode: Preparing to process:", shared.item);
        pdfProcessorNode.setParams({ filePath: shared.item, action: 'extract_text' });
        return prepRes; // Return prepRes
    };
    pdfProcessorNode.postAsync = async (shared, prepRes, execRes) => {
        shared.pdfTextContent = execRes; // Store extracted text
        console.log('PDFProcessorNode: Extracted text length:', shared.pdfTextContent.length);
        return 'default'; // Explicitly return 'default'
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
        console.log('SemanticMemoryNode: Storing memory for:', shared.item);
        return prepRes; // Return prepRes
    };
    semanticMemoryNode.postAsync = async (shared, prepRes, execRes) => {
        console.log('SemanticMemoryNode: Memory stored for:', shared.item);
        return 'default'; // Explicitly return 'default'
    };

    // Chain nodes within the subFlow
    subFlow.start(pdfProcessorNode).next(semanticMemoryNode);

    // 6. Iterator Node
    const iteratorNode = new IteratorNode();
    iteratorNode.prepAsync = async (shared, prepRes) => {
        // The items for iteration are in shared.filteredPdfFiles
        console.log('IteratorNode: Preparing to iterate over:', shared.filteredPdfFiles.length, 'items');
        iteratorNode.setParams({
            items: shared.filteredPdfFiles,
            flow: subFlow,
        });
        return prepRes; // Return prepRes
    };
    iteratorNode.postAsync = async (shared, prepRes, execRes) => {
        console.log('IteratorNode: Iteration completed.');
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
    const interactiveInputNode = new InteractiveInputNode();
    
    interactiveInputNode.setParams({
        prompt: 'Enter your query: ',
    });
    interactiveInputNode.postAsync = async (shared, prepRes, execRes) => {
        shared.interactiveInputResult = execRes;
        return execRes;
    };

    const setQueryNode = new TransformNode();
    setQueryNode.setParams({
        transformFunction: `(data) => ({ query: data.interactiveInputResult })`
    });

    const semanticMemoryNode = new SemanticMemoryNode();
    semanticMemoryNode.setParams({
        action: 'retrieve',
        topK: 3,
    });

    const transformNode = new TransformNode();
    transformNode.setParams({
        transformFunction: `(data) => ({ prompt: 'Context:\n' + data.semanticMemoryResult.map(doc => doc.content).join('\n\n') + '\n\nQuestion: ' + data.interactiveInputResult + '\n\nAnswer:' })`
    });

    const llmNode = new DeepSeekLLMNode();
    llmNode.setParams({
        apiKey: process.env.DEEPSEEK_API_KEY,
    });

    const queryingFlow = new AsyncFlow();
    queryingFlow.start(interactiveInputNode)
        .next(setQueryNode)
        .next(semanticMemoryNode)
        .next(transformNode)
        .next(llmNode);

    return queryingFlow;
}
