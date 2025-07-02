const testHandler = (data, url, query, params, protocol, method, remoteIP, host, sender) => {
	return protocol + '://' + url + ' said (' + method + ") to " + host + ': ' + JSON.stringify(data);
};

module.exports = {
	handlers: [
		{
			name: "test1", // 必须
			protocol: null,
			methods: ['GET', 'POST'],
			url: "/api", // 必须
			onlyFullPath: false,
			concurrent: 1,
			threadMode: 0, // 0: inside process; 1: one-time thread; 2: shared thread pool
			handler: testHandler, // 必须
		},
		{
			name: "test2",
			url: "/api/test",
			onlyFullPath: true,
			concurrent: 3,
			threadMode: 2, // 0: inside process; 1: one-time thread; 2: shared thread pool
			handler: testHandler,
		}
	]
};