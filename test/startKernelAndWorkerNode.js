require('../common/logger');
const logger = new Logger('Kernel&Worker');

const SynegoBase = require('../');

SynegoBase.startKernel("./config4Kernel.json", "./config4Worker.json", 2)
.then(() => {
	logger.log('Kernel & Worker DONE');
})
.catch((err) => {
	logger.error('Kernel & Worker ERROR');
	logger.error(err);
});