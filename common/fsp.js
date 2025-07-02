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

// Read and Load configuration
globalThis.loadConfig = async (configPath, DefaultConfig = {}) => {
	if (!configPath) {
		console.warn('No config file path provided. Using default configuration.');
		return DefaultConfig;
	}

    try {
		if (await fileExists(configPath)) {
			const configData = await fsp.readFile(configPath, 'utf8');
			try {
				return deepMerge(JSON.parse(configData), DefaultConfig);
			}
			catch (err) {
				console.error(`Load Configuration Failed: ${err.message}`);
				return DefaultConfig;
			}
		}
		else {
			console.warn(`Config file not found at ${configPath}. Using default configuration.`);
			return DefaultConfig;
		}
	}
	catch (error) {
		console.error(`Error reading or parsing config file: ${error.message}`);
		return DefaultConfig;
	}
};