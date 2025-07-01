require('../common/logger');
const logger = new Logger('Kernel');

const SynegoBase = require('../');

SynegoBase.startKernel("./config2.json")
.then(() => {
	logger.log('Kernel DONE');
})
.catch((err) => {
	logger.error('Kernel ERROR');
	logger.error(err);
});