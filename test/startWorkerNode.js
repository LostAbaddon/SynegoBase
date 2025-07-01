require('../common/logger');
const logger = new Logger('Worker');

const SynegoBase = require('../');

SynegoBase.startWorker("./config4Worker.json")
.then(() => {
	logger.log('Worker DONE');
})
.catch((err) => {
	logger.error('Worker ERROR');
	logger.error(err);
});