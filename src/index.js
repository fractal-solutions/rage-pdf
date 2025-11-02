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
            await queryingWorkflow.runAsync(shared); // No need to store result here, as LLM response is in shared.llmResponse
            // Check for exit condition after running the workflow
            const userInput = shared.interactiveInputResult; // Get the latest user input

            if (userInput === null || userInput.toLowerCase() === '@exit' || userInput.toLowerCase() === '@quit') {
                console.log('Exiting querying workflow.');
                break;
            }
            // The LLM response is now displayed by the interactiveInputNode itself,
            // so we don't need to log it here.
            // console.log('LLM Response:', shared.llmResponse); // This line can be removed or modified
        } catch (error) {
            console.error('Error running querying workflow:', error);
            return;
        }
    }
}

main();