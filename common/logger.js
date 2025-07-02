(() => {
	// --- 1. 环境检测 ---
	const Environments = {
		BROWSER: 'BROWSER',
		NODE_LIKE: 'NODE_LIKE',
		UNKNOWN: 'UNKNOWN'
	};

	const detectEnvironment = () => {
		// 优先检查 Node.js, Deno, Bun 等服务器端环境
		// 它们都有一个全局的 `process` 对象 (Deno/Bun为了兼容性也提供了)
		const isNodeLike = typeof process !== 'undefined' && process.versions != null && (!!process.versions.node || !!process.versions.bun || !!process.versions.deno);
		if (isNodeLike) {
			return Environments.NODE_LIKE;
		}

		// 检查浏览器环境 (主线程或 Worker)
		// 浏览器主线程有 `window` 和 `document`
		const isBrowserMainThread = typeof window !== 'undefined' && typeof window.document !== 'undefined';
		// Web Worker 或 Service Worker 有 `self` 并且其构造函数名包含 'WorkerGlobalScope'
		const isBrowserWorker = typeof self !== 'undefined' && self.constructor && self.constructor.name.includes('WorkerGlobalScope');

		if (isBrowserMainThread || isBrowserWorker) {
			return Environments.BROWSER;
		}

		// PhantomJS (虽然已过时) 或其他未知环境
		return Environments.UNKNOWN;
	};

	const ENV = detectEnvironment();

	// --- 2. 样式定义 ---

	// 为 Node.js 环境准备的 ANSI 终端颜色代码
	const AnsiColors = {
		reset: "\x1b[0m",
		bold: "\x1b[1m",
		fg: {
			black: "\x1b[30m",
			white: "\x1b[37m",
		},
		bg: {
			blue: "\x1b[44m",
			yellow: "\x1b[43m",
			red: "\x1b[41m",
			green: "\x1b[42m",
		},
	};

	// 为浏览器环境准备的 CSS 样式
	const CssStyles = {
		base: "color: #ffffff; padding: 2px 6px; border-radius: 3px; font-weight: bold;",
		info: "background-color: #007bff;",
		log: "background-color: #28a745;",
		warn: "background-color: #ffc107; color: #000000;",
		error: "background-color: #dc3545;"
	};

	// --- 3. Logger 类实现 ---
	const LoggerLevel = {
		"log": 0,
		"info": 1,
		"warn": 2,
		"error": 3
	};

	class Logger {
		/**
		 * 创建一个 Logger 实例.
		 * @param {string} context - 日志上下文，将显示在日志前缀中，如 'API', 'Database' 等.
		 */
		constructor(context) {
			if (!context || typeof context !== 'string') {
				throw new Error('Logger context must be a non-empty string.');
			}
			this.context = context;
		}
		/**
		 * 内部核心打印方法
		 * @private
		 */
		_print(level, args) {
			const l = LoggerLevel[level] || 0;
			if (l < Logger.level) return;

			const contextPrefix = `[${this.context}]`;

			if (ENV === Environments.BROWSER) {
				// 浏览器环境：使用 %c 和 CSS
				const style = `${CssStyles.base} ${CssStyles[level]}`;
				console[level](`%c${contextPrefix}`, style, ...args);
			}
			else if (ENV === Environments.NODE_LIKE) {
				// Node.js 类环境：使用 ANSI 颜色码
				let color;
				switch(level) {
					case 'warn': color = AnsiColors.bg.yellow + AnsiColors.fg.black; break;
					case 'error': color = AnsiColors.bg.red + AnsiColors.fg.white; break;
					case 'log': color = AnsiColors.bg.green + AnsiColors.fg.white; break;
					case 'info':
					default:
						color = AnsiColors.bg.blue + AnsiColors.fg.white; break;
				}
				const styledPrefix = `${AnsiColors.bold}${color}${contextPrefix}${AnsiColors.reset}`;
				console[level](styledPrefix, ...args);
			}
			else {
				// 未知环境或 PhantomJS，回退到不带样式的输出
				console[level](contextPrefix, ...args);
			}
		}
		/**
		 * 输出参考信息 (蓝色/默认).
		 * @param	{...any} args - 要打印的内容.
		 */
		info(...args) {
			this._print('info', args);
		}
		/**
		 * 输出通用日志 (绿色).
		 * @param	{...any} args - 要打印的内容.
		 */
		log(...args) {
			this._print('log', args);
		}
		/**
		 * 输出警告信息 (黄色).
		 * @param	{...any} args - 要打印的内容.
		 */
		warn(...args) {
			this._print('warn', args);
		}
		/**
		 * 输出错误信息 (红色).
		 * @param	{...any} args - 要打印的内容.
		 */
		error(...args) {
			this._print('error', args);
		}

		static level = 0;
		static setLevel (level) {
			if (!(level >= 0 && level < 5)) return;
			level = Math.floor(level);
			Logger.level = level;
		}
	}

	globalThis.Logger = Logger;
}) ();