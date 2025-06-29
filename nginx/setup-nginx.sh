#!/bin/bash

# This script is now an EXAMPLE of how to use the SynegoBase library from the command line.
# In a real project, you would typically call the setup function from your own Node.js script.

# Get the root directory of the project where the script is being run from.
# This assumes the script is run from the project root.
PROJECT_ROOT="$(pwd)"
SYNEGO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." &> /dev/null && pwd )"

CONFIG_FILE="${PROJECT_ROOT}/my-nginx-config.json"

# Prepare the node command to execute.
# It will require the SynegoBase library and call the setupNginx function.
# It passes the config (if it exists) and the calling project's root directory.
NODE_COMMAND="
const synego = require('${SYNEGO_ROOT}');
const fs = require('fs');
const path = require('path');

const configFile = '${CONFIG_FILE}';
const projectRoot = '${PROJECT_ROOT}';

let userConfig = {};
if (fs.existsSync(configFile)) {
    console.log('Loading configuration from:', configFile);
    userConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
} else {
    console.log('No my-nginx-config.json found, using default settings.');
}

synego.setupNginx(userConfig, projectRoot);
"

# Execute the command using node -e
node -e "$NODE_COMMAND"
