import { createIndexingWorkflow, createQueryingWorkflow } from './workflows';
import { promises as fs } from 'fs';
import path from 'path';

const dataDir = path.resolve(process.cwd(), 'data');

async function main() {
    // Create data directory if it doesn't exist
    try {
        await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
        console.error('Error creating data directory:', error);
        return;
    }

    // Create and run the indexing workflow
    console.log('Starting indexing workflow...');
    const indexingWorkflow = createIndexingWorkflow(dataDir);
    const shared = {};
    try {
        await indexingWorkflow.runAsync(shared);
        console.log('Indexing workflow completed.');
    } catch (error) {
        console.error('Error running indexing workflow:', error);
        return;
    }

    // Create and run the querying workflow in a loop
    console.log('Starting querying workflow...');
    const queryingWorkflow = createQueryingWorkflow();
    while (true) {
        try {
            const result = await queryingWorkflow.runAsync(shared);
            console.log('LLM Response:', result);
        } catch (error) {
            console.error('Error running querying workflow:', error);
        }

        const interactiveInputNode = queryingWorkflow.startNode;
        if (interactiveInputNode.params.prompt.toLowerCase() === 'exit' || interactiveInputNode.params.prompt.toLowerCase() === 'quit') {
            break;
        }
    }
}

main();