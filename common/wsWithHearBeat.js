class WSWithHearbeat {
	static HeartBeatPing = 'heartbeat_ping';
	static HeartBeatPong = 'heartbeat_pong';
	static WSEvents = ['open', 'close', 'message', 'error'];

	#heartbeatInterval = 30000;
	#idleDuration = 300000;

	#ws;
	#events = {};

	#timerHeartBeat;
	#timerIdleMonitor;

	constructor (url, hbInterval=30000, idleDuration=300000) {
		this.#heartbeatInterval = hbInterval;
		this.#idleDuration = idleDuration;

		this.#ws = new WebSocket(url);

		this.#ws.onopen = (...args) => {
			if (!!this.onopen) {
				this.onopen(...args);
			}
			if (!!this.#events.open) {
				this.#events.open.some(cb => {
					const out = cb(...args);
					if (out === true) return true;
				});
			}
		};
		this.#ws.onerror = (...args) => {
			if (!!this.onerror) {
				this.onerror(...args);
			}
			if (!!this.#events.error) {
				this.#events.error.some(cb => {
					const out = cb(...args);
					if (out === true) return true;
				});
			}
		};
		this.#ws.onclose = () => {
			if (!!this.#timerHeartBeat) clearTimeout(this.#timerHeartBeat);
			if (!!this.#timerIdleMonitor) clearTimeout(this.#timerIdleMonitor);

			if (!!this.onclose) {
				this.onclose();
			}
			if (!!this.#events.close) {
				this.#events.close.some(cb => {
					const out = cb(...args);
					if (out === true) return true;
				});
			}

			this.#ws = null;
		};
		this.#ws.onmessage = (event) => {
			this.#resetHeartbeat();
			if (event.data === WSWithHearbeat.HeartBeatPong) return;
			this.#resetIdle();

			if (!!this.onmessage) {
				this.onmessage(event);
			}
			if (!!this.#events.message) {
				this.#events.message.some(cb => {
					const out = cb(...args);
					if (out === true) return true;
				});
			}
		};

		this.#resetHeartbeat();
		this.#resetIdle();
	}
	send (message) {
		this.#resetHeartbeat();
		this.#resetIdle();

		this.#ws.send(message);
	}
	close () {
		this.#ws.close();
	}
	on (event, callback) {
		if (!WSWithHearbeat.WSEvents.includes(event)) return;
		if (!this.#events[event]) {
			this.#events[event] = [];
		}
		this.#events[event].push(callback);
	}

	#resetHeartbeat () {
		if (!!this.#timerHeartBeat) clearTimeout(this.#timerHeartBeat);
		this.#timerHeartBeat = setTimeout(() => {
			this.#ws.send(WSWithHearbeat.HeartBeatPing);
		}, this.#heartbeatInterval);
	}
	#resetIdle () {
		if (!!this.#timerIdleMonitor) clearTimeout(this.#timerIdleMonitor);
		this.#timerIdleMonitor = setTimeout(() => {
			this.#ws.close();
		}, this.#idleDuration);
	}

	onmessage = null;
	onclose = null;
	onerror = null;
	onopen = null;

	get readyState () {
		return this.#ws.readyState;
	}
	get url () {
		return this.#ws.url;
	}
	get protocol () {
		return this.#ws.protocol;
	}
	get binaryType () {
		return this.#ws.binaryType;
	}
	get bufferedAmount () {
		return this.#ws.bufferedAmount;
	}
	get extensions () {
		return this.#ws.extensions;
	}
}

globalThis.WSWithHearbeat = WSWithHearbeat;