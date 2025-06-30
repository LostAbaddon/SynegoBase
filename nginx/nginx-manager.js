const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const platform = os.platform();

require('../common/common'); // 常用函数与工具集
require('../common/logger'); // 富文本 console 工具
const logger = new Logger('Nginx');

const DefaultConfig = {
	server_name: "localhost",
	http: {
		enabled: true,
		port: 8080,
	},
	https: {
		enabled: false,
		port: 8443,
		force_https_redirect: true,
		ssl_certificate: "",
		ssl_certificate_key: ""
	},
	worker_connections: 256,
	logs: { dir: "./logs/nginx" },
	static_serving: [
		{ url_path: "/static", root_path: "./public" }
	],
	spa_serving: [],
	upload: {},
	reverse_proxy: [{ enabled: true, url_path: "/", pass_to: "http://localhost:3000" }]
};

// Helper to run shell commands
function runCommand(command, options = { stdio: 'pipe' }) {
	const output = execSync(command, options);
	return output ? output.toString().trim() : null;
}

// --- Nginx Installation ---
function checkNginxInstalled() {
	const command = platform === 'win32' ? 'where nginx' : 'which nginx';
	try {
		return runCommand(command) !== null;
	}
	catch (err) {
		return false;
	}
}

function installNginx() {
	// (Implementation remains the same as before)
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		logger.log('Nginx is not installed. Would you like to try and install it automatically? (y/n)');
		rl.question('                                                                                     ', (answer) => {
			rl.close();
			if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
				logger.log('Skipping installation. Please install Nginx manually.');
				return resolve(false);
			}
			// ... installation logic for each OS ...
			logger.log('Attempting to install Nginx...');
			try {
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
		try {
			const brewPath = runCommand('which brew');
			if (brewPath && brewPath.startsWith('/opt/homebrew')) return '/opt/homebrew';
			return '/usr/local';
		}
		catch (err) {
			logger.error('Get Brew Prefix Failed:', err);
			return null;
		}
	}
	return null;
}

function getNginxConfigPath() {
	let confPath = null;
	switch (platform) {
		case 'darwin':
			confPath = path.join(getBrewPrefix(), 'etc', 'nginx', 'nginx.conf');
			break;
		case 'linux':
			if (fs.existsSync('/etc/nginx/nginx.conf')) confPath = '/etc/nginx/nginx.conf';
			else if (fs.existsSync('/usr/local/nginx/conf/nginx.conf')) confPath = '/usr/local/nginx/conf/nginx.conf';
			else return null;
			break;
		case 'win32':
			try {
				const nginxPath = runCommand('where nginx');
				if (!nginxPath) return null;
				confPath = path.join(path.dirname(nginxPath), '.', 'conf', 'nginx.conf');
				break;
			}
			catch (err) {
				logger.error('Get Nginx Config Path Failed:', err);
				return null;
			}
		default:
			return null;
	}
	if (!confPath) return null;

	if (!fs.existsSync(confPath)) confPath = null;

	return confPath;
}

function generateNginxConfig(config, callingProjectRoot) {
	const logDir = path.resolve(callingProjectRoot, config.logs.dir);
	if (!fs.existsSync(logDir)) {
		fs.mkdirSync(logDir, { recursive: true });
	}

	let locationBlocks = [], grpcBlocks = [], streamBlocks = [];
	// 静态资源服务
	if (!isArray(config.static_serving)) config.static_serving = [config.static_serving];
	config.static_serving.forEach(serving => {
		if (!serving || !serving.url_path || !serving.root_path) return;
		const staticRoot = path.resolve(callingProjectRoot, serving.root_path);
		let type = 'alias';
		if (serving.type === 'root') {
			type = 'root';
		}
		let block = `
		location ${serving.url_path} {
			${type} ${staticRoot.replace(/\\/g, '/')}/;
			autoindex on;
		}`;
		locationBlocks.push([serving.url_path.length, block]);
	});

	// SPA站点服务
	if (!isArray(config.spa_serving)) config.spa_serving = [config.spa_serving];
	config.spa_serving.forEach(serving => {
		if (!serving || !serving.url_path || !serving.root_path) return;
		const spaRoot = path.resolve(callingProjectRoot, serving.root_path);
		let type = 'alias';
		if (serving.type === 'root') {
			type = 'root';
		}
		let block = `
		location ${serving.url_path} {
			${type} ${spaRoot.replace(/\\/g, '/')}/;
			try_files $uri $uri/ /index.html;
		}`;
		locationBlocks.push([serving.url_path.length, block]);
	});

	// 文件上传服务
	if (config.upload && config.upload.url_path && config.upload.temp_path && config.upload.pass_to) {
		const tempPath = path.resolve(callingProjectRoot, config.upload.temp_path);
		if (!fs.existsSync(tempPath)) {
			fs.mkdirSync(tempPath, { recursive: true });
		}
		const maxBodySize = config.upload.max_body_size || '100m';

		let block = `
		location ${config.upload.url_path} {
			client_body_in_file_only on;
			client_body_temp_path ${tempPath.replace(/\\/g, '/')};
			client_max_body_size ${maxBodySize};

			proxy_pass ${config.upload.pass_to};

			proxy_set_header Content-Disposition $http_content_disposition;
			proxy_set_header X-Content-Type $http_content_type;
			proxy_set_header X-File-Path $request_body_file;

			proxy_set_header Host $host;
			proxy_set_header X-Real-IP $remote_addr;
			proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
			proxy_set_header X-Forwarded-Proto $scheme;

			proxy_set_body off;
			proxy_redirect off;
		}`;
		locationBlocks.push([config.upload.url_path.length, block]);
	}

	// API反向代理、WebSocket、gRPC、TCP、UDP
	if (!isArray(config.reverse_proxy)) config.reverse_proxy = [config.reverse_proxy];
	config.reverse_proxy.forEach(serving => {
		if (!serving || !serving.pass_to || (serving.enabled === false)) return;

		let block;

		if (serving.type === 'tcp') {
			if (!serving.port)return;
			block = `
	server {
		listen                ${serving.port};
		proxy_pass            ${serving.pass_to};
		proxy_timeout         ${serving.timeout || "10s"};
		proxy_connect_timeout ${serving.connect_timeout || "5s"};
	}`;
			streamBlocks.push(block);
			return;
		}
		else if (serving.type === 'udp') {
			if (!serving.port)return;
			block = `
	server {
		listen          ${serving.port} udp;
		proxy_pass      ${serving.pass_to};
		proxy_responses 1;
	}`;
			streamBlocks.push(block);
			return;
		}
		else if (!serving.url_path) {
			return;
		}

		// 如果是 WebSocket 请求
		if (serving.type === "websocket") {
			block = `
		location ${serving.url_path} {
			proxy_pass ${serving.pass_to};
			proxy_set_header Host $host;
			proxy_http_version 1.1;
			proxy_set_header Upgrade $http_upgrade;
			proxy_set_header Connection "upgrade";
			proxy_set_header X-Real-IP $remote_addr;
			proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
			proxy_set_header X-Forwarded-Proto $scheme;
		}`;
		}
		// 如果是 gRPC 请求
		if (serving.type === "grpc") {
			block = `
		location ${serving.url_path} {
			grpc_pass         ${serving.pass_to};
			grpc_read_timeout 300s;
			grpc_send_timeout 300s;
		}`;
			grpcBlocks.push(block);
			return;
		}
		// 普通请求
		else {
			block = `
		location ${serving.url_path} {
			proxy_pass ${serving.pass_to};
			proxy_set_header Host $host;
			proxy_set_header X-Real-IP $remote_addr;
			proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
			proxy_set_header X-Forwarded-Proto $scheme;
		}`;
		}
		locationBlocks.push([serving.url_path.length, block]);
	});

	locationBlocks.sort((ba, bb) => ba[0] - bb[0]);
	const locations = locationBlocks.map(block => block[1]).join('');
	const grpcs     = grpcBlocks.join('');
	const streams   = streamBlocks.length > 0 ? 'stream {' + streamBlocks.join('') + '\n}' : '';

	let http_server_block = '';
	let https_server_block = '';

	const https_config = config.https || {}, http_config = config.http || {};

	const http_enabled = http_config.enabled === false ? false : true;
	http_config.port = http_config.port || DefaultConfig.http.port;

	const cert_path = https_config.ssl_certificate ? path.resolve(callingProjectRoot, https_config.ssl_certificate) : null;
	const key_path = https_config.ssl_certificate_key ? path.resolve(callingProjectRoot, https_config.ssl_certificate_key) : null;
	const https_enabled = (https_config.enabled !== false) && cert_path && key_path && fs.existsSync(cert_path) && fs.existsSync(key_path);
	https_config.port = https_config.port || DefaultConfig.https.port;

	if (https_config.force_https_redirect !== false) https_config.force_https_redirect = true;
	const http_available = !https_enabled || !https_config.force_https_redirect;

	// HTTPS server block
	if (https_enabled) {
		https_server_block = `
	server {
		listen       ${https_config.port} ssl http2;
		listen       [::]:${https_config.port} ssl http2;
		server_name  ${config.server_name};

		ssl_certificate      "${cert_path.replace(/\\/g, '/')}";
		ssl_certificate_key  "${key_path.replace(/\\/g, '/')}";

		ssl_session_cache    shared:SSL:10m;
		ssl_session_timeout  5m;
		ssl_protocols        TLSv1.2 TLSv1.3;
		ssl_ciphers          'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';
		ssl_prefer_server_ciphers on;

		${locations}
		${grpcs}
	}`;
	}

	// HTTP server block
	if (http_enabled) {
		// No force redirect to HTTPS
		if (http_available) {
			http_server_block = `
	server {
		listen       ${http_config.port};
		listen       [::]:${http_config.port};
		server_name  ${config.server_name};
		${locations}
	}`;
		}
		// Force redirect to HTTPS
		else {
			const redirectUrl = (https_config.port === 443) ? 'https://$host$request_uri' : `https://$host:${https_config.port}$request_uri`;
			http_server_block = `
	server {
		listen       ${http_config.port};
		listen       [::]:${http_config.port};
		server_name  ${config.server_name};
		return       301 ${redirectUrl};
	}`;
		}
	}

	return `worker_processes  auto;
error_log  "${path.join(logDir, 'error.log').replace(/\\/g, '/')}" warn;
pid        "${path.join(logDir, 'nginx.pid').replace(/\\/g, '/')}";
events {
	worker_connections  ${config.worker_connections};
}

${streams}

http {
	include            mime.types;
	default_type       application/octet-stream;

	log_format  main   '$remote_addr - $remote_user [$time_local] "$request" '
	                     '$status $body_bytes_sent "$http_referer" '
	                     '"$http_user_agent" "$http_x_forwarded_for"';
	access_log         "${path.join(logDir, 'access.log').replace(/\\/g, '/')}"  main;
  
	sendfile           on;
	tcp_nopush         on;
	keepalive_timeout  65;

	gzip               on;
	gzip_vary          on;
	gzip_proxied       any;
	gzip_comp_level    6;
	gzip_buffers       16 8k;
	gzip_http_version  1.1;
	gzip_types         text/plain text/css application/json text/javascript application/javascript text/xml application xml application/xml+rss;
  
	${http_server_block}
	${https_server_block}
}`;
}

async function setupNginx(userConfig = {}, callingProjectRoot = process.cwd()) {
	// 如果传入的是地址，则读取真正的配置文件
	if (isString(userConfig)) {
		userConfig = path.join(process.cwd(), userConfig);
		try {
			const data = fs.readFileSync(userConfig);
			userConfig = JSON.parse(data);
		}
		catch (err) {
			logger.error('Read User Config Failed:', err);
			userConfig = {};
		}
	}

	const finalConfig = deepMerge(DefaultConfig, userConfig);

	if (!checkNginxInstalled()) {
		const installed = await installNginx();
		if (!installed) return false; // Stop if user cancels or installation fails
		await wait(2000); // Wait for service
	}
	logger.log('Proceeding with Nginx configuration...');

	const configPath = getNginxConfigPath() || userConfig.nginxConfPath;
	console.log('----------------->', configPath);
	if (!configPath || !fs.existsSync(path.dirname(configPath))) {
		logger.error('Could not determine Nginx config path or directory does not exist.');
		return false;
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
		logger.info("New Nginx Configuration Generated:");
		console.info(newConfigContent);
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

	return true;
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
			}
			catch (error) {
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

	try {
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
		execSync(command, {
			stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
		});
		logger.log(`Nginx service command for '${action}' executed successfully.`);
	}
	catch (error) {
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
		}
		else {
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