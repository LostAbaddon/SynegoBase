const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
require('../common/logger');
const logger = new Logger('Test:gRPC');

const PROTO_PATH = path.resolve(__dirname, '../configExample/service.example.proto');
const port = 3004;
const host = '127.0.0.1';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
	keepCase: true,
	longs: String,
	enums: String,
	defaults: true,
	oneofs: true
});

const serviceProto = grpc.loadPackageDefinition(packageDefinition).main;
const client = new serviceProto.MyService(`${host}:${port}`, grpc.credentials.createInsecure());

const message = 'Hello gRPC Server!';
logger.log(`Sending: "${message}"`);

client.MyMethod({ data: message }, (err, response) => {
	if (err) {
		logger.error('gRPC error:', err);
		return;
	}
	logger.log(`Received: "${response.reply}"`);
});
