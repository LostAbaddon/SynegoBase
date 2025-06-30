const http = require('http');
const https = require('httpsys');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const net = require('net');
const dgram = require('dgram');
const readline = require('readline');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const busboy = require('busboy');

require('../common/common'); // 常用函数与工具集
require('../common/fsp');    // 文件相关工具
require('../common/logger'); // 富文本 console 工具
const logger = new Logger('Kernel');

// --- 统一请求处理函数 ---

/**
 * 所有请求的统一处理入口
 * @param {object} requestData - 标准化后的请求数据
 */
function requestHandler(requestData) {
	logger.log("--- New Request Received ---");
	logger.log(JSON.stringify(requestData, null, 2));

	// 在这里编写您的核心业务逻辑
	// 例如: 根据 requestData.protocol 和 requestData.url 来决定如何响应
	// 为了演示，我们仅打印收到的数据
}

// --- 1. HTTP 和 HTTPS 服务器设置 ---
const app = express();
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

// Nginx 会处理文件上传，然后通过这个接口通知 Node.js
// 请求体中应包含如 { "filePath": "/path/on/nginx/server/file.txt" } 的信息
app.post('/upload-callback', async (req, res) => {
	if (req.method !== 'POST' && req.method !== 'PUT') {
		return res.status(403).send({
			code: 403,
			message: "Resource Forbidden",
		});
	}

	const logger = new Logger('Kernel:Uploader');
	const tempFilePath = req.headers['x-file-path'];

	if (!tempFilePath || !(await fileExists(tempFilePath))) {
		logger.error('  - Error: Temp file not found at the specified path.');
		res.writeHead(400, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ message: 'Error: Temp file not found.' }));
		return;
	}

	logger.log('File upload callback received:');
	logger.log(`  - Temp File Path: ${tempFilePath}`);

	const bb = busboy({ headers: req.headers });
	let originalFilename = 'unknown_file';
	let permanentPath = '';

	bb.on('file', (fieldname, file, info) => {
		const { filename, encoding, mimeType } = info;
		originalFilename = filename;
		// Sanitize filename to prevent directory traversal attacks
		const safeFilename = path.basename(originalFilename);
		// Create a unique filename to avoid overwrites
		const uniqueFilename = `${Date.now()}-${safeFilename}`;
		const uploadsDir = path.join(__dirname, 'uploads');

		// Ensure the 'uploads' directory exists
		fs.mkdirSync(uploadsDir, { recursive: true });
		permanentPath = path.join(uploadsDir, uniqueFilename);

		logger.log(`  - Parsing file: ${originalFilename}`);
		logger.log(`  - Saving to: ${permanentPath}`);

		const writeStream = fs.createWriteStream(permanentPath);
		file.pipe(writeStream);
	});

	bb.on('close', () => {
		logger.log('  - Busboy finished parsing.');
		// The temporary file from Nginx is no longer needed
		fs.unlink(tempFilePath, (err) => {
			if (err) logger.error(`  - Error deleting temp file: ${err.message}`);
			else logger.log(`  - Successfully deleted temp file: ${tempFilePath}`);
		});

		// Construct a public URL instead of a file system path
		const publicUrl = path.join('/uploads', path.basename(permanentPath)).replace(/\\/g, '/');

		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({
			success: true,
			message: "File uploaded successfully.",
			url: publicUrl,
		}));
	});
	
	bb.on('error', (err) => {
		logger.error(`  - Busboy error: ${err.message}`);
		fs.unlink(tempFilePath, () => {}); // Clean up temp file on error
		res.writeHead(500, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ code: 500, error: 'Error processing upload.' }));
	});

	// We pipe the *actual* temporary file stream from Nginx into Busboy
	const tempFileStream = fs.createReadStream(tempFilePath);
	tempFileStream.pipe(bb);



	const requestData = {
		protocol: req.protocol,
		method: req.method,
		url: req.path,
		params: req.params,
		query: req.query,
		body: req.body,
		ip: req.ip,
		rawUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
		file: {
			path: req.body.filePath || null
		}
	};
	requestHandler(requestData);
	res.status(200).send('Notification received');
});

// 通用路由，捕获所有其他 HTTP/HTTPS 请求
app.all('*', (req, res) => {
	const requestData = {
		protocol: req.protocol,
		method: req.method,
		url: req.path,
		params: req.params,
		query: req.query,
		body: req.body,
		ip: req.ip,
		rawUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
	};
	requestHandler(requestData);
	res.status(200).send('Request received');
});


// 创建 HTTP 服务器
const httpServer = http.createServer(app);
httpServer.listen(3000, () => {
	console.log('HTTP Server listening on port 3000');
});

// 创建 HTTPS 服务器 (需要 SSL 证书)
// 您可以使用 mkcert 或 openssl 生成自签名证书用于开发
// openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes
try {
	const options = {
		key: fs.readFileSync('key.pem'),
		cert: fs.readFileSync('cert.pem')
	};
	const httpsServer = https.createServer(options, app);
	httpsServer.listen(3001, () => {
		console.log('HTTPS Server listening on port 3001');
	});
	setupWebSocketServer(httpsServer); // 绑定 WebSocket 到 HTTPS
} catch (error) {
	console.log('Could not start HTTPS server. SSL certificate files (key.pem, cert.pem) might be missing.');
}


// --- 2. WebSocket 服务器设置 ---
function setupWebSocketServer(server) {
	const wss = new WebSocket.Server({ server });
	wss.on('connection', (ws, req) => {
		const ip = req.socket.remoteAddress;
		ws.on('message', (message) => {
			const requestData = {
				protocol: server instanceof https.Server ? 'wss' : 'ws',
				method: null,
				url: req.url,
				params: {},
				query: {},
				body: message.toString(),
				ip: ip,
				rawUrl: req.url
			};
			requestHandler(requestData);

			// 示例：回显收到的消息
			ws.send(`Echo: ${message}`);
		});

		console.log(`WebSocket client connected from ${ip}`);
	});
	console.log(`WebSocket Server is running and attached to ${server instanceof https.Server ? 'HTTPS' : 'HTTP'} server.`);
}
setupWebSocketServer(httpServer); // 绑定 WebSocket 到 HTTP


// --- 3. TCP 服务器设置 ---
const tcpServer = net.createServer((socket) => {
	const ip = socket.remoteAddress;
	console.log(`TCP client connected from ${ip}`);

	socket.on('data', (data) => {
		const requestData = {
			protocol: 'tcp',
			method: null,
			url: null,
			params: {},
			query: {},
			body: data.toString(),
			ip: ip,
			rawUrl: null
		};
		requestHandler(requestData);
	});

	socket.on('end', () => {
		console.log(`TCP client from ${ip} disconnected`);
	});

	socket.on('error', (err) => {
		console.error('TCP Socket Error: ', err);
	});
});
tcpServer.listen(3002, () => {
	console.log('TCP Server listening on port 3002');
});


// --- 4. UDP 服务器设置 ---
const udpServer = dgram.createSocket('udp4');
udpServer.on('error', (err) => {
	console.error(`UDP Server Error:\n${err.stack}`);
	udpServer.close();
});
udpServer.on('message', (msg, rinfo) => {
	const requestData = {
		protocol: 'udp',
		method: null,
		url: null,

		params: {},
		query: {},
		body: msg.toString(),
		ip: `${rinfo.address}:${rinfo.port}`,
		rawUrl: null
	};
	requestHandler(requestData);
});
udpServer.on('listening', () => {
	const address = udpServer.address();
	console.log(`UDP Server listening on ${address.address}:${address.port}`);
});
udpServer.bind(3003);


// --- 5. gRPC 服务器设置 ---
const PROTO_PATH = './service.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
	keepCase: true,
	longs: String,
	enums: String,
	defaults: true,
	oneofs: true
});
const serviceProto = grpc.loadPackageDefinition(packageDefinition).main;

const grpcServer = new grpc.Server();

grpcServer.addService(serviceProto.MyService.service, {
	MyMethod: (call, callback) => {
		const requestData = {
			protocol: 'grpc',
			method: 'MyMethod', // gRPC method name
			url: '/main.MyService/MyMethod', // gRPC URL path
			params: {},
			query: {},
			body: call.request,
			ip: call.getPeer(),
			rawUrl: null
		};
		requestHandler(requestData);
		callback(null, { reply: 'gRPC request received for: ' + call.request.data });
	}
});

grpcServer.bindAsync('0.0.0.0:3004', grpc.ServerCredentials.createInsecure(), (err, port) => {
	if (err) {
		console.error('gRPC server error:', err);
		return;
	}
	grpcServer.start();
	console.log(`gRPC Server listening on port ${port}`);
});


// --- 6. 命令行接口 (CLI) ---
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	prompt: 'SERVER_CMD> '
});

rl.on('line', (line) => {
	const requestData = {
		protocol: 'cli',
		method: null,
		url: null,
		params: {},
		query: {},
		body: line.trim(),
		ip: 'localhost',
		rawUrl: null
	};
	requestHandler(requestData);
	rl.prompt();
}).on('close', () => {
	console.log('Exiting CLI.');
	process.exit(0);
});

console.log('Command Line Interface is ready. Type a command and press Enter.');
rl.prompt();