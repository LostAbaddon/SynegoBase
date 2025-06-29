const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const platform = os.platform();

require('../common/common'); // 常用函数与工具集
require('../common/logger'); // 富文本 console 工具
const logger = new Logger('Nginx');

// Helper to run shell commands
function runCommand(command, options = { stdio: 'pipe' }) {
	try {
		const output = execSync(command, options);
		return output ? output.toString().trim() : null;
	}
	catch (error) {
		return null;
	}
}

// --- Nginx Installation ---
function checkNginxInstalled() {
	const command = platform === 'win32' ? 'where nginx' : 'which nginx';
	return runCommand(command) !== null;
}

function installNginx() {
	// (Implementation remains the same as before)
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		rl.question('Nginx is not installed. Would you like to try and install it automatically? (y/n) ', (answer) => {
			rl.close();
			if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
				logger.log('Skipping installation. Please install Nginx manually.');
				return resolve(false);
			}
			// ... installation logic for each OS ...
			logger.log('Attempting to install Nginx...');
			let installCommand;
			switch (platform) {
				case 'darwin':
					installCommand = 'brew install nginx';
					break;
				case 'linux':
					if (runCommand('which apt')) installCommand = 'sudo apt update && sudo apt install -y nginx';
					else if (runCommand('which yum')) installCommand = 'sudo yum install -y nginx';
					else { logger.error('Could not find apt or yum.'); return resolve(false); }
					break;
				case 'win32':
					installCommand = 'choco install nginx -y';
					break;
				default:
					logger.error(`Unsupported OS: ${platform}.`);
					return resolve(false);
			}
			try {
				runCommand(installCommand, { stdio: 'inherit' });
				logger.log('Nginx installed successfully.');
				resolve(true);
			}
			catch (error) {
				logger.error('Failed to install Nginx.', error.message);
				resolve(false);
			}
		});
	});
}

// --- Nginx Configuration ---
function getBrewPrefix() {
	if (platform === 'darwin') {
		const brewPath = runCommand('which brew');
		if (brewPath && brewPath.startsWith('/opt/homebrew')) return '/opt/homebrew';
		return '/usr/local';
	}
	return null;
}

function getNginxConfigPath() {
	// (Implementation remains the same)
	switch (platform) {
		case 'darwin':
			return path.join(getBrewPrefix(), 'etc', 'nginx', 'nginx.conf');
		case 'linux':
			if (fs.existsSync('/etc/nginx/nginx.conf')) return '/etc/nginx/nginx.conf';
			if (fs.existsSync('/usr/local/nginx/conf/nginx.conf')) return '/usr/local/nginx/conf/nginx.conf';
			return null;
		case 'win32':
			const nginxPath = runCommand('where nginx');
			return nginxPath ? path.join(path.dirname(nginxPath), '..', 'conf', 'nginx.conf') : null;
		default:
			return null;
	}
}

function generateNginxConfig(config, callingProjectRoot) {
	const logDir = path.resolve(callingProjectRoot, config.logs.dir);
	if (!fs.existsSync(logDir)) {
		fs.mkdirSync(logDir, { recursive: true });
	}

	let staticBlocks = '';
	if (Array.isArray(config.static_serving)) {
		staticBlocks = config.static_serving.map(serving => {
			const staticRoot = path.resolve(callingProjectRoot, serving.root_path);
			return `
    location ${serving.url_path} {
      alias ${staticRoot.replace(/\\/g, '/')};
      autoindex on;
    }`;
		}).join('');
	}

	let proxyBlock = '';
	if (config.reverse_proxy && config.reverse_proxy.enabled) {
		proxyBlock = `
    location ${config.reverse_proxy.url_path} {
      proxy_pass ${config.reverse_proxy.pass_to};
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }`;
	}

	return `
worker_processes  1;
error_log  "${path.join(logDir, 'error.log').replace(/\\/g, '/')}" warn;
pid        "${path.join(logDir, 'nginx.pid').replace(/\\/g, '/')}";
events { worker_connections  ${config.worker_connections}; }
http {
  include            mime.types;
  default_type       application/octet-stream;

  log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

  access_log         "${path.join(logDir, 'access.log').replace(/\\/g, '/')}"  main;
  
  sendfile           on;
  keepalive_timeout  65;
  
  server {
    listen       ${config.http_port};
    server_name  ${config.server_name};${staticBlocks}${proxyBlock}
  }
}`;
}

async function setupNginx(userConfig = {}, callingProjectRoot = process.cwd()) {
	const defaultConfig = {
		http_port: 8080,
		server_name: "localhost",
        worker_connections: 1024,
		logs: { dir: "./logs/nginx" },
		static_serving: [
			{ url_path: "/static", root_path: "./public" }
		],
		reverse_proxy: { enabled: true, url_path: "/", pass_to: "http://localhost:3000" }
	};

	const finalConfig = deepMerge(defaultConfig, userConfig);

	if (!checkNginxInstalled()) {
		const installed = await installNginx();
		if (!installed) return; // Stop if user cancels or installation fails
		await wait(2000); // Wait for service
	}
	logger.log('Proceeding with Nginx configuration...');

	const configPath = getNginxConfigPath();
	if (!configPath || !fs.existsSync(path.dirname(configPath))) {
		logger.error('Could not determine Nginx config path or directory does not exist.');
		return;
	}

	const backupPath = `${configPath}.bak.${Date.now()}`;
	logger.log(`Nginx config path found: ${configPath}`);
	let configWritten = false;
	try {
		if (fs.existsSync(configPath)) {
			fs.copyFileSync(configPath, backupPath);
			logger.log(`Backed up existing config to ${backupPath}`);
		}
		const newConfigContent = generateNginxConfig(finalConfig, callingProjectRoot);
		fs.writeFileSync(configPath, newConfigContent);
		logger.log('Successfully wrote new nginx.conf.');
		configWritten = true;
	}
	catch (error) {
		logger.error('Error during configuration setup:', error.message);
		logger.error('Try running with sudo/admin rights.');
	}

	if (configWritten) {
		copyControlScripts(callingProjectRoot);
	}
}

function copyControlScripts(callingProjectRoot) {
    logger.log('Copying and configuring control scripts to your project root...');
    const sourceDir = path.resolve(__dirname); // The 'nginx' directory
    const targetDir = callingProjectRoot;
    const scripts = ['start-nginx.sh', 'stop-nginx.sh', 'restart-nginx.sh', 'start-nginx.bat', 'stop-nginx.bat', 'restart-nginx.bat'];

    // The absolute path to the synegobase library's main entry point (index.js)
    const synegoBasePath = path.resolve(sourceDir, '..', 'index.js');
    // For the require() statement, we need to escape backslashes on Windows
    const requirePath = synegoBasePath.replace(/\\/g, '\\\\');

    scripts.forEach(scriptName => {
        const sourceFile = path.join(sourceDir, scriptName);
        const targetFile = path.join(targetDir, scriptName);

        if (fs.existsSync(sourceFile)) {
            try {
                // Read the template content
                const templateContent = fs.readFileSync(sourceFile, 'utf-8');
                // Replace the placeholder with the actual, escaped path
                const finalContent = templateContent.replace('__SYNEGOBASE_PATH__', requirePath);
                // Write the new content to the target file
                fs.writeFileSync(targetFile, finalContent);

                logger.log(`- Created ${scriptName}`);
                if (scriptName.endsWith('.sh')) {
                    fs.chmodSync(targetFile, '755');
                }
            } catch (error) {
                logger.error(`Failed to create ${scriptName}:`, error.message);
            }
        }
    });
    logger.log('Control scripts are ready in your project root.');
}

function controlNginx(action) {
    if (!checkNginxInstalled()) {
        logger.error('Nginx is not installed. Please run setup first.');
        return;
    }
    let command;
    switch (platform) {
        case 'darwin':
            command = `${getBrewPrefix()}/bin/brew services ${action} nginx`;
            break;
        case 'linux':
            command = `sudo systemctl ${action} nginx`;
            break;
        case 'win32':
            const nginxPath = path.dirname(runCommand('where nginx'));
            const actionMap = { start: 'start nginx', stop: 'nginx -s stop', restart: 'nginx -s reload' };
            command = `cd ${nginxPath} && ${actionMap[action]}`;
            break;
        default:
            logger.error(`Unsupported platform: ${platform}`);
            return;
    }

    logger.log(`Executing: ${command}`);
    
    // We need to capture stderr to analyze it, so we can't use 'inherit' directly
    let stderr = '';
    try {
        execSync(command, {
            stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
        });
        logger.log(`Nginx service command for '${action}' executed successfully.`);
    } catch (error) {
        stderr = error.stderr ? error.stderr.toString() : '';
        
        logger.error(`The command to '${action}' Nginx failed.`);

        if (platform === 'darwin' && stderr.includes('Bootstrap failed')) {
            logger.warn("macOS Service Error Detected.");
            logger.log("This is a common issue with Homebrew services if the service fails to start immediately.");
            logger.log("The 'brew services' command may show a success message, but the underlying service has failed.");
            logger.log("SUGGESTED ACTIONS:");
            logger.log("1. Check your Nginx configuration syntax: nginx -t");
            logger.log("2. Check the Nginx error log, likely in your project's 'logs' directory.");
            logger.log("3. If the problem persists, try the full reset process: brew reinstall nginx");
        } else {
            logger.error("An unexpected error occurred.");
            if (stderr) {
                logger.log("Error details (stderr):");
                console.error(stderr);
            }
        }
    }
}

module.exports = {
	setupNginx,
	controlNginx,
};