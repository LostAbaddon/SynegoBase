globalThis.wait = delay => new Promise(res => setTimeout(res, delay));

globalThis.newID = (len=16) => {
	var id = [];
	for (let i = 0; i < len; i ++) {
		let d = Math.floor(Math.random() * 36).toString(36);
		id.push(d);
	}
	return id.join('');
};

globalThis.deepMerge = (target, source) => {
	if (target === null || target === undefined) return source;
	if (!isObject(target) || !isObject(source)) return target;

	const output = { ...target };
	Object.keys(source).forEach(key => {
		output[key] = deepMerge(target[key], source[key]);
	});
	return output;
};

/* Type Tools */

globalThis.AsyncFunction = (async function() {}).__proto__;
globalThis.isArray = obj => obj !== null && obj !== undefined && !!obj.__proto__ && obj.__proto__.constructor === Array;
globalThis.isString = obj => obj !== null && obj !== undefined && !!obj.__proto__ && obj.__proto__.constructor === String;
globalThis.isNumber = obj => obj !== null && obj !== undefined && !!obj.__proto__ && obj.__proto__.constructor === Number;
globalThis.isBoolean = obj => obj !== null && obj !== undefined && !!obj.__proto__ && obj.__proto__.constructor === Boolean;
globalThis.isObject = obj => obj !== null && obj !== undefined && !!obj.__proto__ && obj.__proto__.constructor === Object;
globalThis.isFunction = obj => obj !== null && obj !== undefined && !!obj.__proto__ && (obj.__proto__.constructor === Function || obj.__proto__ === AsyncFunction || obj.__proto__.constructor === AsyncFunction);
globalThis.isAsyncFunction = obj => obj !== null && obj !== undefined && !!obj.__proto__ && (obj.__proto__ === AsyncFunction || obj.__proto__.constructor === AsyncFunction);

/* Auxillary Utils and Extends for DateTime */

const WeekDayNames = {
	enS: ['Sun', "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
	enL: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
	zhM: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
	zhT: ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'],
};

const getLongString = (short, len=2, isLeft=true) => {
	var long = short + '';
	while (long.length < len) {
		if (isLeft) long = '0' + long;
		else long = long + '0';
	}
	return long;
};
const getInfoStrings = (info, type) => {
	var short, long;

	if (type === 'Y') {
		long = info + '';
		short = long.substring(2);
	}
	else if (type === 'ms') {
		short = info + '';
		long = getLongString(info, 3, false);
	}
	else {
		short = info + '';
		long = getLongString(info);
	}

	return [short, long];
};
globalThis.timestmp2str = (time, format) => {
	if (isString(time) && !isString(format)) {
		format = time;
		time = null;
	}
	if (!isString(format)) format = "YYYY/MM/DD hh:mm:ss";

	time = time || new Date();
	if (isNumber(time)) time = new Date(time);

	var [shortYear       , longYear       ] = getInfoStrings(time.getYear() + 1900, 'Y');
	var [shortMonth      , longMonth      ] = getInfoStrings(time.getMonth() + 1, 'M');
	var [shortDay        , longDay        ] = getInfoStrings(time.getDate(), 'D');
	var [shortHour       , longHour       ] = getInfoStrings(time.getHours(), 'h');
	var [shortMinute     , longMinute     ] = getInfoStrings(time.getMinutes(), 'm');
	var [shortSecond     , longSecond     ] = getInfoStrings(time.getSeconds(), 's');
	var [shortMilliSecond, longMilliSecond] = getInfoStrings(time.getMilliseconds(), 'ms');
	var weekdayES = WeekDayNames.enS[time.getDay()];
	var weekdayEL = WeekDayNames.enL[time.getDay()];
	var weekdayZM = WeekDayNames.zhM[time.getDay()];
	var weekdayZT = WeekDayNames.zhT[time.getDay()];

	if (!!format.match(/YYYY+/)) {
		format = format.replace(/YYYY+/g, longYear);
	}
	else if (!!format.match(/Y+/)) {
		format = format.replace(/Y+/g, shortYear);
	}
	if (!!format.match(/MM+/)) {
		format = format.replace(/MM+/g, longMonth);
	}
	else if (!!format.match(/M+/)) {
		format = format.replace(/M+/g, shortMonth);
	}
	if (!!format.match(/DD+/)) {
		format = format.replace(/DD+/g, longDay);
	}
	else if (!!format.match(/D+/)) {
		format = format.replace(/D+/g, shortDay);
	}
	if (!!format.match(/hh+/)) {
		format = format.replace(/hh+/g, longHour);
	}
	else if (!!format.match(/h+/)) {
		format = format.replace(/h+/g, shortHour);
	}
	if (!!format.match(/mm+/)) {
		format = format.replace(/mm+/g, longMinute);
	}
	else if (!!format.match(/m+/)) {
		format = format.replace(/m+/g, shortMinute);
	}
	if (!!format.match(/ss+/)) {
		format = format.replace(/ss+/g, longSecond);
	}
	else if (!!format.match(/s+/)) {
		format = format.replace(/s+/g, shortSecond);
	}
	if (!!format.match(/xxx+/)) {
		format = format.replace(/xxx+/g, longMilliSecond);
	}
	else if (!!format.match(/x+/)) {
		format = format.replace(/x+/g, shortMilliSecond);
	}

	format = format.replace(/:wde:/g, weekdayES);
	format = format.replace(/:WDE:/g, weekdayEL);
	format = format.replace(/:wdz:/g, weekdayZM);
	format = format.replace(/:WDZ:/g, weekdayZT);

	return format;
};
globalThis.convertTimeToArray = time => {
	time = new Date(time);
	let Y = time.getYear() + 1900;
	let M = time.getMonth() + 1;
	let D = time.getDate();
	let h = time.getHours();
	let m = time.getMinutes();
	let s = time.getSeconds();
	return [Y, M, D, h, m, s];
};
globalThis.shiftTimeToDayStart = time => {
	let [y, m, d] = convertTimeToArray(time);
	time = new Date(y + '/' + m + '/' + d);
	return time.getTime();
};
globalThis.timeDifference = (timeA, timeB) => {
	if (!timeB) {
		timeB = Date.now();
	}
	else if (timeA > timeB) {
		[timeA, timeB] = [timeB, timeA];
	}

	const [Y1, M1, D1, h1, m1, s1] = convertTimeToArray(timeA);
	const [Y2, M2, D2, h2, m2, s2] = convertTimeToArray(timeB);
	let dY = Y2 - Y1;
	let dM = M2 - M1;
	let dD = D2 - D1;
	let dh = h2 - h1;
	let dm = m2 - m1;
	let ds = s2 - s1;

	if (dM < 0) {
		dY --;
		dM += 12;
	}
	else if (dM === 0) {
		if (dD < 0) {
			dY --;
			dM = 12;
		}
		else if (dD === 0) {
			if (dh < 0) {
				dY --;
				dM = 12;
			}
			else if (dh === 0) {
				if (dm < 0) {
					dY --;
					dM = 12;
				}
				else if (dm === 0) {
					if (ds < 0) {
						dY --;
						dM = 12;
					}
				}
			}
		}
	}
	if (dY > 0) return dY + ' years ago';

	if (dD < 0) {
		dM --;
	}
	else if (dD === 0) {
		if (dh < 0) {
			dM --;
		}
		else if (dh === 0) {
			if (dm < 0) {
				dM --;
			}
			else if (dm === 0) {
				if (ds < 0) {
					dM --;
				}
			}
		}
	}
	if (dM > 0) return dM + ' months ago';

	dD = Math.floor((timeB - timeA) / 1000 / 3600 / 24);
	if (dD > 0) return dD + ' days ago';

	dh = Math.floor((timeB - timeA) / 1000 / 3600);
	if (dh > 0) return dh + ' hours ago';

	dm = Math.floor((timeB - timeA) / 1000 / 60);
	if (dm > 0) return dm + ' minutes ago';

	ds = Math.floor((timeB - timeA) / 1000);
	return ds + ' seconds ago';
};
