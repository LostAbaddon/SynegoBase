const fsp = require('fs').promises;

// Helper function
globalThis.fileExists = async (filePath) => {
    try {
        await fsp.access(filePath);
        return true;
    }
	catch {
        return false;
    }
};