const os = require('os');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const cluster = require('cluster');
const { Transform } = require('stream');

require('../common/common'); // 常用函数与工具集
require('../common/fsp');	// 文件相关工具
require('../common/logger'); // 富文本 console 工具
const logger = new Logger('Kernel');
const { generateNodeId } = require('../common/identity');
const EgoNodeId = generateNodeId();

const ShakeHandHosts = [];
const MemberManager = require('./memberCenter');
const EventCenter = require('./eventCenter');

// ---- 辅助类 ---
class ProtocolParser extends Transform {
	constructor(socket) {
		super();
		this.socket = socket;
		this.realIp = socket.remoteAddress;
		this.realPort = socket.remotePort;
		this.headerParsed = false;
		this._buffer = Buffer.alloc(0);
	}

	_transform(chunk, encoding, callback) {
		this._buffer = Buffer.concat([this._buffer, chunk]);

		if (!this.headerParsed) {
			try {
				const ProxyProtocol = require('proxy-protocol-js');
				const header = ProxyProtocol.parse(this._buffer);
				if (header && header.source) {
					this.realIp = header.source.ip;
					this.realPort = header.source.port;
					this._buffer = this._buffer.slice(header.headerLength);
					logger.log(`TCP client connected from ${this.realIp}:${this.realPort} (via PROXY)`);
				}
			}
			catch {
				// Ignore parse errors, wait for more data or assume direct connection
			}
			this.headerParsed = true;
			if (!this.realIp) {
				 logger.log(`TCP client connected from ${this.socket.remoteAddress}:${this.socket.remotePort} (direct)`);
				 this.realIp = this.socket.remoteAddress;
				 this.realPort = this.socket.remotePort;
			}
		}

		let boundary = this._buffer.indexOf('\n');
		while (boundary !== -1) {
			const message = this._buffer.slice(0, boundary);
			this.push(message);
			this._buffer = this._buffer.slice(boundary + 1);
			boundary = this._buffer.indexOf('\n');
		}

		callback();
	}
}

// --- 默认配置 ---
const DefaultConfig = {
	"http": {
		"enabled": true,
		"port": 3000
	},
	"https": {
		"enabled": false,
		"port": 3001,
		"key": "key.pem",
		"cert": "cert.pem"
	},
	"ws": {
		"enabled": true
	},
	"tcp": {
		"enabled": true,
		"port": 3002
	},
	"udp": {
		"enabled": true,
		"port": 3003
	},
	"grpc": {
		"enabled": true,
		"port": 3004,
		"proto": "service.proto"
	},
	"cli": {
		"enabled": true,
		"ipc_path": os.platform() === 'win32' ? '\\\\.\\pipe\\synego_kernel_ipc' : '/tmp/synego_kernel.sock'
	},
	"upload": {
		"enabled": true,
		"urlpath": "/upload-callback",
		"filepath": "./uploads"
	},
	"shakehand": {
		"ws": 3000,
		"ipc": "/tmp/synego_communicate.sock"
	}
};

// --- 各模块初始化 ---

/* TCP Server */
const setupTCPServer = (port) => new Promise(res => {
	const net = require('net');
	const server = net.createServer(socket => {
		const parser = new ProtocolParser(socket);
		socket.pipe(parser);
		const sender = (data) => socket.write(JSON.stringify(data) + '\n');
		sender.id = newID();

		parser.on('data', async (message) => {
			const msg = convertParma(message.toString().trim());
			if (!isObject(msg) || !msg.event) {
				return;
			}
			const rid = msg.rid;
			let reply;
			try {
				reply = await requestHandler({
					protocol: 'tcp',
					ip: parser.realIp + ":" + parser.realPort,
					method: msg.method || 'GET',
					url: msg.event,
					body: msg.data,
					params: {},
					query: {},
					host: "tcp://" + port,
					rawUrl: "tcp://" + port + (msg.event.match(/^\?/) ? "" : '/') + msg.event,
					sender,
				});
			}
			catch (err) {
				reply = commonErrorHandler(err);
			}
			if (rid && reply) reply.rid = rid;
			sender(reply);
		});

		socket.on('error', (err) => logger.error('TCP Socket Error: ', err));
		socket.on('end', () => {
			MemberManager.signOut(sender.id);
			logger.log(`TCP client from ${parser.realIp} disconnected`);
		});
	});

	server.listen(port, () => {
		logger.log(`TCP Server listening on port ${port}`);
		res();
	});
});
/* UDP Server */
const setupUDPServer = (port) => new Promise(res => {
	const dgram = require('dgram');
	const udpServer = dgram.createSocket('udp4');
	udpServer.on('message', async (msg, rinfo) => {
		let realIp = rinfo.address;
		let realPort = rinfo.port;
		let body = msg;

		try {
			const ProxyProtocol = require('proxy-protocol-js');
			const header = ProxyProtocol.parse(msg);
			if (header && header.source) {
				realIp = header.source.ip || realIp;
				realPort = header.source.port || realPort;
				body = msg.slice(header.headerLength);
			}
		}
		catch (e) {
			// 解析��败，是直连，忽略错误
		}

		msg = convertParma(body.toString().trim());
		if (!isObject(msg) || !msg.event) {
			return;
		}
		const rid = msg.rid;
		let reply;
		try {
			reply = await requestHandler({
				protocol: 'udp',
				ip: `${realIp}:${realPort}`,
				method: msg.method || 'GET',
				url: msg.event,
				body: msg.data,
				params: {},
				query: {},
				host: "udp://" + port,
				rawUrl: "udp://" + port + (msg.event.match(/^\?/) ? "" : '/') + msg.event,
				sender: (data) => udpServer.send(JSON.stringify(data), realPort, realIp),
			});
		}
		catch (err) {
			reply = commonErrorHandler(err);
		}
		if (rid && reply) reply.rid = rid;
		udpServer.send(JSON.stringify(reply), realPort, realIp);
	});
	udpServer.on('listening', () => {
		const address = udpServer.address();
		logger.log(`UDP Server listening on ${address.address}:${address.port}`);
		res();
	});
	udpServer.bind(port);
});
/* gRPC Server */
const setupGRPCServer = (port, protoFilePath) => new Promise(async res => {
	const PROTO_PATH = path.resolve(process.cwd(), protoFilePath);
	if (!(await fileExists(PROTO_PATH))) {
		logger.error(`Proto file not found: ${PROTO_PATH}`);
		return res();
	}

	try {
		const grpc = require('@grpc/grpc-js');
		const protoLoader = require('@grpc/proto-loader');
		const packageDefinition = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
		const serviceProto = grpc.loadPackageDefinition(packageDefinition).main;
		const grpcServer = new grpc.Server();
		grpcServer.addService(serviceProto.MyService.service, {
			MyMethod: async (call, callback) => {
				const forwardedFor = call.metadata.get('x-forwarded-for');
				const ip = forwardedFor.length > 0 ? forwardedFor[0] : call.getPeer();
				const msg = convertParma(call.request.data);
				if (!isObject(msg) || !msg.event) {
					return;
				}
				const rid = msg.rid;
				let reply;
				try {
					reply = await requestHandler({
						protocol: 'grpc',
						ip,
						method: msg.method || 'GET',
						url: msg.event,
						body: msg.data,
						params: {},
						query: {},
						host: "grpc://" + port,
						rawUrl: "grpc://" + port + (msg.event.match(/^\?/) ? "" : '/') + msg.event,
						sender: data => callback(null, { reply: JSON.stringify(data) })
					});
				}
				catch (err) {
					reply = commonErrorHandler(err);
				}
				if (rid && reply) reply.rid = rid;
				callback(null, { reply: JSON.stringify(reply) });
			}
		});
		grpcServer.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
			if (err) {
				logger.error('gRPC server error:', err);
			}
			else {
				logger.log(`gRPC Server listening on port ${port}`);
			}
			res();
		});
	}
	catch (error) {
		logger.error("Could not start gRPC server:", error);
		res();
	}
});
/* IPC Server */
const setupIPCServer = (ipc_path) => new Promise(async res => {
	const ipcPath = ipc_path;
	// Clean up old socket file if it exists
	if (os.platform() !== 'win32' && (await fileExists(ipcPath))) {
		await fsp.unlink(ipcPath);
	}

	const net = require('net');
	const ipcServer = net.createServer((socket) => {
		const sender = (data) => socket.write(JSON.stringify(data) + '\n');
		sender.id = newID();
		logger.log('IPC client connected.');

		socket.on('data', async (data) => {
			const msg = convertParma(data.toString().trim());
			if (!isObject(msg) || !msg.event) {
				return;
			}
			const rid = msg.rid;
			let reply;
			try {
				reply = await requestHandler({
					protocol: 'ipc',
					ip: 'console',
					method: msg.method || 'GET',
					url: msg.event,
					body: msg.data,
					params: {},
					query: {},
					host: "ipc://" + ipc_path,
					rawUrl: "ipc://" + ipc_path + (msg.event.match(/^\?/) ? "" : '/') + msg.event,
					sender,
				});
			}
			catch (err) {
				reply = commonErrorHandler(err);
			}
			if (rid && reply) reply.rid = rid;
			sender(reply);
		});
		socket.on('end', () => {
			MemberManager.signOut(sender.id);
			logger.log('IPC client disconnected.')
		});
		socket.on('error', (err) => logger.error('IPC Socket Error:', err));
	});
	ipcServer.listen(ipcPath, () => {
		logger.log(`IPC server listening on ${ipcPath}`);
		res();
	});
	process.on('exit', () => {
		ipcServer.close();
		if (os.platform() !== 'win32') fs.unlinkSync(ipcPath);
	});
});
/* WebSocket Server */
const setupWebSocketServer = (server, port) => {
	const https = require('https');
	const WebSocket = require('ws');
	const wss = new WebSocket.Server({ server });
	wss.on('connection', (ws, req) => {
		const sender = (data) => ws.send(JSON.stringify(data));
		sender.id = newID();
		const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
		logger.log(`WebSocket client connected from ${ip}`);

		ws.on('message', async (message) => {
			const msg = convertParma(message.toString().trim());
			if (msg === 'heartbeat_ping') {
				ws.send('heartbeat_pong');
				return;
			}
			if (!isObject(msg) || !msg.event) {
				return;
			}
			const rid = msg.rid;
			let reply;
			try {
				const protocol = server instanceof https.Server ? 'wss' : 'ws';
				reply = await requestHandler({
					protocol,
					ip: ip,
					method: msg.method || 'GET',
					url: msg.event,
					body: msg.data,
					params: {},
					query: {},
					host: protocol + "://" + port,
					rawUrl: protocol + "://" + port + (msg.event.match(/^\?/) ? "" : '/') + msg.event,
					sender,
				});
			}
			catch (err) {
				reply = commonErrorHandler(err);
			}
			if (rid && reply) reply.rid = rid;
			sender(reply);
		});
		ws.on('close', () => {
			MemberManager.signOut(sender.id);
			logger.log(`WebSocket client disconnected: ${ip}`);
		});
	});
	logger.log(`WebSocket Server attached to ${server instanceof https.Server ? 'HTTPS' : 'HTTP'} server.`);
};
/* SubProcess Server */
const setupSubProcessServer = (worker, workerConfigPath) => {
	const sender = (data) => worker.send(data);
	sender.id = newID();
	worker.on('message', async (msg) => {
		if (!isObject(msg) || !msg.event) {
			return;
		}
		const rid = msg.rid;
		let reply;
		try {
			reply = await requestHandler({
				protocol: 'worker',
				ip: "subprocess",
				method: msg.method || 'GET',
				url: msg.event,
				body: msg.data,
				params: {},
				query: {},
				host: "worker://" + worker.process.pid,
				rawUrl: "worker://" + worker.process.pid + (msg.event.match(/^\?/) ? "" : '/') + msg.event,
				sender,
			});
		}
		catch (err) {
			reply = commonErrorHandler(err);
		}
		if (rid && reply) reply.rid = rid;
		sender(reply);
	});
	worker.on('exit', () => {
		MemberManager.signOut(sender.id);
		logger.log(`SubProcess Worker disconnected: ${worker.process.pid}`);
		// Restart a Worker
		wait(1000).then(() => {
			setupSubProcessServer(cluster.fork({
				rootPath: process.cwd(),
				config: workerConfigPath
			}), workerConfigPath);
		});
	});
};

// --- 内部功能 ---
const InnerResponsor = {};
InnerResponsor['/synego/shakehand'] = (data, query, params, protocol, method, remoteIP, host, sender) => {
	const nodeID = data.nid;
	if (!nodeID) {
		return {
			success: false,
			reason: 'No ID'
		}
	}
	if (!sender.id) {
		return {
			success: false,
			reason: 'No Channel ID'
		}
	}

	if (remoteIP !== 'subprocess' && !ShakeHandHosts.includes(host)) {
		logger.warn('Invalid Shakehand: ' + remoteIP + " via " + host);
		return {
			success: false,
			reason: 'Invalid Shakehand Channel'
		}
	}

	MemberManager.signIn(data, sender);

	return {
		success: true,
		nodeID: EgoNodeId
	}
};

// --- 统一请求处理函数 ---
const requestHandler = async (requestData) => {
	if (!requestData.url) {
		return {
			code: 403,
			error: "Empty Request URL",
		}
	}

	const handler = InnerResponsor[requestData.url];
	if (!!handler) {
		try {
			const reply = await handler(requestData.body, requestData.query, requestData.params, requestData.protocol, requestData.method, requestData.ip, requestData.host, requestData.sender);
			return reply;
		}
		catch (err) {
			logger.error('Service Response Failed:', err);
			return {
				code: 500,
				error: "Something wrong...",
			}
		}
	}

	return await EventCenter.invoke(requestData);
};
const commonErrorHandler = (err) => {
	logger.error('Event Handler Failed:', err);
	return {
		code: 500,
		error: "service down",
	};
}

/**
 * 启动主响应节点
 * @param {string} [configPath] - 配置文件的可选路径。
 */
const start = async (configPath, workerConfigPath, workerCount) => {
	const config = await loadConfig(configPath, DefaultConfig);
	const initTasks = [];
	let wsPorts = null;

	// HTTP/HTTPS/WS 服务器
	if ((config.http?.enabled && config.http?.port) || (config.https?.enabled && config.https?.port) || (config.upload?.enabled && config.upload?.urlpath)) {
		const express = require('express');
		const cors = require('cors');

		const app = express();
		app.use(cors()); // 在所有路由前使用 CORS 中间件
		app.use(express.json());
		app.use(express.urlencoded({ extended: true }));

		// 上传回调处理
		if (config.upload?.enabled && config.upload?.urlpath) {
			const busboy = require('busboy');
			const uploadsDir = path.join(process.cwd(), config.upload.filepath || './uploads');
			await fsp.mkdir(uploadsDir, { recursive: true });
			logger.log('Upload Folder Ready: ' + uploadsDir);

			app.post(config.upload.urlpath, async (req, res) => {
				const logger = new Logger('Kernel:Uploader');
				const tempFilePath = req.headers['x-file-path'];
				const contentTypeHeader = req.headers['x-content-type']; // Nginx passes original Content-Type here

				let stream;
				const cfg = {};
				if (!!contentTypeHeader) cfg.headers = { 'content-type': contentTypeHeader };
				else cfg.headers = req.headers;
				const bb = busboy(cfg);

				// Scenario 1: Request is coming from Nginx upload proxy
				if (tempFilePath) {
					if (!(await fileExists(tempFilePath))) {
						logger.error('  - Error: Temp file specified by Nginx not found.');
						res.status(400).json({ code: 404, error: 'Uploaded temp file not found.' });
						return;
					}

					logger.info('New Upload Request (from Nginx): ' + tempFilePath);
					stream = fs.createReadStream(tempFilePath);
				}
				// Scenario 2: Direct browser upload (no Nginx proxy)
				else {
					logger.info('New Upload Request (Direct): ' + (tempFilePath || 'Direct browser upload'));
					stream = req;
				}

				bb.on('file', (fieldname, file, info) => {
					const { filename } = info;
					const safeFilename = path.basename(filename);
					const uniqueFilename = `${Date.now()}-${safeFilename}`;
					const permanentPath = path.join(uploadsDir, uniqueFilename);
					logger.log(`  - Saving to: ${permanentPath}`);

					const writeStream = fs.createWriteStream(permanentPath);
					file.pipe(writeStream);

					writeStream.on('finish', () => {
						const publicUrl = path.join('/', config.upload.filepath, uniqueFilename).replace(/\\/g, '/');
						if (!res.headersSent) {
							res.json({ success: true, url: publicUrl });
						}
					});
				});
				bb.on('close', () => {
					if (!tempFilePath) return;

					stream.close();

					// This event fires after all parts have been processed.
					// Now it's safe to delete the temporary file.
					fs.unlink(tempFilePath, (err) => {
						if (err) logger.error(`  - Error deleting temp file: ${err.message}`);
						else logger.log(`  - Deleted temp file: ${tempFilePath}`);
					});
				});
				bb.on('error', (err) => {
					if (tempFilePath) {
						logger.error(`  - Busboy error while processing temp file: ${err.message}`);
						stream.destroy(); // Stop reading the file on error
					}
					else {
						logger.error(`  - Busboy error: ${err.message}`);
					}
					if (!res.headersSent) {
						res.status(500).json({ code: 500, error: 'Error processing uploaded file data.' });
					}
				});

				stream.pipe(bb);
			});
			logger.log('Uploader Ready: ' + config.upload.urlpath);
		}

		// 通用路由
		app.use(async (req, res) => {
			const protocol = req.headers['x-forwarded-proto'] || req.protocol;
			const ip = req.headers['x-forwarded-for'] || req.ip;
			const msg = convertParma(req.body || "");
			try {
				const reply = await requestHandler({
					protocol: protocol,
					method: req.method,
					url: req.path,
					params: req.params,
					query: req.query,
					body: msg,
					ip: ip,
					host: `${protocol}://${req.get('host')}:${req.get('port') || '0'}`,
					rawUrl: `${protocol}://${req.get('host')}:${req.get('port') || '0'}${req.originalUrl}`,
					sender: () => {},
				});
				if (!res.headersSent) res.status(200).send(reply);
			}
			catch (err) {
				const reply = commonErrorHandler(err);
				if (!res.headersSent) res.status(500).send(reply);
			}
		});

		// HTTP 服务器
		if (config.http?.enabled && config.http?.port) {
			const http = require('http');
			const httpServer = http.createServer(app);
			wsPorts = config.http.port;
			httpServer.listen(config.http.port, () => logger.log(`HTTP Server listening on port ${config.http.port}`));
			if (config.ws?.enabled) setupWebSocketServer(httpServer, config.http.port);
		}

		// HTTPS 服务器
		if (config.https?.enabled && config.https?.port) {
			const https = require('https');
			try {
				const options = { key: fs.readFileSync(config.https.key), cert: fs.readFileSync(config.https.cert) };
				const httpsServer = https.createServer(options, app);
				httpsServer.listen(config.https.port, () => logger.log(`HTTPS Server listening on port ${config.https.port}`));
				if (config.ws?.enabled) setupWebSocketServer(httpsServer, config.https.port);
			}
			catch (error) {
				logger.error("Could not start HTTPS server:", error);
			}
		}
	}

	// TCP 服务器
	if (config.tcp?.enabled && config.tcp?.port) {
		initTasks.push(setupTCPServer(config.tcp.port));
	}

	// UDP 服务器
	if (config.udp?.enabled && config.udp?.port) {
		initTasks.push(setupUDPServer(config.udp.port));
	}

	// gRPC 服务器
	if (config.grpc?.enabled && config.grpc?.port && config.grpc?.proto) {
		initTasks.push(setupGRPCServer(config.grpc.port, config.grpc.proto));
	}

	// 命令行接口 (IPC) 服务器
	if (config.cli?.enabled && config.cli?.ipc_path) {
		initTasks.push(setupIPCServer(config.cli.ipc_path));
	}

	// 集群内部通讯
	if (!!config.shakehand?.ipc) {
		ShakeHandHosts.push('ipc://' + config.shakehand.ipc);
		initTasks.push(setupIPCServer(config.shakehand.ipc));
	}
	if (!!config.shakehand?.ws) {
		ShakeHandHosts.push('ws://' + config.shakehand.ws);
		if (config.shakehand.ws !== wsPorts) {
			initTasks.push((async () => {
				const http = require('http');
				const httpServer = http.createServer();
				httpServer.listen(config.shakehand.ws, () => logger.log(`HTTP Server listening on port ${config.shakehand.ws}`));
				setupWebSocketServer(httpServer, config.shakehand.ws);
			}) ());
		}
	}

	// 处理主节点级响应事件
	if (!!config.handlers) {
		initTasks.push(EventCenter.amount(config.handlers));
	}

	await Promise.all(initTasks);
	logger.log(`Kernel node starting with ID: ${EgoNodeId}`);

	// 使用 Cluster 模式启动 Worker
	if (!!workerConfigPath && (await fileExists(workerConfigPath))) {
		let count = os.cpus().length;
		if (workerCount > 0) {
			workerCount = Math.min(Math.max(count - 2, 1), workerCount);
		}
		else {
			workerCount = Math.max(count - 2, 1);
		}

		logger.log('Launch Worker: ' + workerCount);
		cluster.setupPrimary({
			exec: path.join(__dirname, 'workerNode.js')
		});
		for (let i = 0; i < workerCount; i ++) {
			setupSubProcessServer(cluster.fork({
				rootPath: process.cwd(),
				config: workerConfigPath
			}), workerConfigPath);
		}
	}
};

module.exports = {
	start,
};

// TEST
InnerResponsor['/test'] = (data) => {
	(new Logger('Kernel:Test')).log(data);
	return {
		ok: true,
		data: ">>> [" + data + ']'
	};
};