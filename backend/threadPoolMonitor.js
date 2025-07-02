const { parentPort, workerData, threadId } = require('worker_threads');
require('../common/logger'); // 富文本 console 工具
const logger = new Logger('ThreadPool:' + process.pid + ':' + threadId);

let targetHandler;

const amountHandler = async () => {
	let handler = require(workerData.js);
	if (!handler || !handler.handlers) {
		parentPort.postMessage({
			success: false,
			event: '/amount',
		});
		return;
	}
	handler = handler.handlers.filter(h => h.name === workerData.name)[0];
	if (!handler) {
		parentPort.postMessage({
			success: false,
			event: '/amount',
		});
		return;
	}
	targetHandler = handler;
	
	parentPort.on('message', async msg => {
		if (msg.event === 'task') {
			const tid = msg.tid;
			let reply;
			if (!tid) {
				reply = {
					code: 500,
					error: "missing task id",
				};
			}
			else {
				try {
					reply = await targetHandler.handler(msg.data.body, msg.data.url, msg.data.query, msg.data.params, msg.data.protocol, msg.data.method, msg.data.remoteIP, msg.data.host);
					reply = {
						success: true,
						data: reply,
					};
				}
				catch (err) {
					logger.error('Handler in Thread Pool Error:', err);
					reply = {
						code: 500,
						error: "service down...",
					}
				}
			}
			parentPort.postMessage({ event: '/reply', tid, reply });
		}
	});

	parentPort.postMessage({
		success: true,
		event: '/amount',
	});
	logger.log('Handler Loaded: ' + workerData.js + ' :: ' + workerData.name);
};

amountHandler();