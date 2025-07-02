const { parentPort, workerData, threadId } = require('worker_threads');
require('../common/logger'); // 富文本 console 工具
const logger = new Logger('OnceWorker:' + process.pid + ':' + threadId);

const doJob = async () => {
	let handler = require(workerData.js);
	if (!handler || !handler.handlers) {
		parentPort.postMessage({
			code: 500,
			error: "Invalid Handler File",
		});
		return;
	}
	handler = handler.handlers.filter(h => h.name === workerData.name)[0];
	if (!handler) {
		parentPort.postMessage({
			code: 500,
			error: "Invalid Handler Name",
		});
		return;
	}

	let reply;
	try {
		const data = workerData.data;
		reply = await handler.handler(data.body, data.url, data.query, data.params, data.protocol, data.method, data.remoteIP, data.host);
		reply = {
			success: true,
			data: reply,
		};
	}
	catch (err) {
		logger.error('Do Task Failed:', err);
		reply = {
			code: 500,
			error: "worker down...",
		};
	}
	parentPort.postMessage(reply);
};

doJob();