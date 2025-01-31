const { DateTime } = require('luxon');
const DATE_FORMAT = 'dd.MM.yyyy';

const fn = {
	parseDate(str) {
		return DateTime.fromFormat(str, DATE_FORMAT);
	},
	formatMoney(price) {
		return (new Intl.NumberFormat('pl-PL').format(price)) + ' zł'
	},
	calculatePriceInfos(chronosPoints, chronos, scale) {
		const priceInfos = [];
		let index = 0;
		let toAdd = null;
		while (index < chronosPoints.length - 1) {
			const point = chronosPoints[index];
			let priceChangeIndex = chronosPoints.slice(index)
				.findIndex(p => p.y != point.y);
			priceChangeIndex = priceChangeIndex != -1 ? index + priceChangeIndex : chronosPoints.length;
			const chartPoints = [chronosPoints[index]]
				.concat(chronosPoints[priceChangeIndex - 1]/*, chronosPoints[priceChangeIndex]*/)
				.filter(p => p != undefined);
			if (chronosPoints[priceChangeIndex] && (chronosPoints[priceChangeIndex].y > point.y)) {
				chartPoints.push(chronosPoints[priceChangeIndex]);
			}
			if (toAdd != null) {
				chartPoints.unshift(toAdd);
				toAdd = null;
			}
			const points = chartPoints
				.concat({ x: chartPoints.at(-1).x, y: scale.price }, { x: chartPoints[0].x, y: scale.price });

			if (chronosPoints[priceChangeIndex] && (chronosPoints[priceChangeIndex].y < point.y)) {
				toAdd = chronosPoints[priceChangeIndex-1];
			}

			priceInfos.push({ index, priceChangeIndex, point: chartPoints[0], points });
			index = priceChangeIndex;
		}

		for (const [i, priceInfo] of priceInfos.entries()) {
			const { index, points, point } = priceInfo;
			const price = this.formatMoney(chronos[index].price);
			const priceWidth = price.length * 3.67 + 3;
			const trans = this.translatePriceInfo(
				{ x: 0, y: 0, width: scale.date, height: scale.price },
				// [points],
				priceInfos.slice(i).map(pi => pi.points),
				point.x, point.y, priceWidth, 10);
			const dateRange = [
				Math.min(...points.map(p => p.x)),
				Math.max(...points.map(p => p.x))];

			priceInfo.priceWidth = priceWidth;
			priceInfo.price = price;
			priceInfo.trans = trans;
		}

		return priceInfos;
	},
	translatePriceInfo(viewport, occupieds, x, y, width, height) {
		const vp = dims({ left: viewport.x + 2, top: viewport.y, 
			right: viewport.x + viewport.width - 2, bottom: viewport.y + viewport.height });
		const ocs = occupieds.map(occupied => dims({ 
			left: Math.min(...occupied.map(p => p.x)),
			top: Math.min(...occupied.map(p => p.y)),
			right: Math.max(...occupied.map(p => p.x)),
			bottom: Math.max(...occupied.map(p => p.y)),
			topFirst: occupied[0].y,
		}));
		const oc = ocs[0];
		const it = dims({ left: x, top: y, 
			right: x + width, bottom: y + height });
		
		let tx = 0;
		let ty = 0;

		if (translate(it, { ty: -12 }).top >= vp.top) {
			ty = -12;
			tx = 2;
			if (it.right > vp.right) {
				tx = -(it.width - oc.width + 2);
			}
		} else {
			ty = vp.top - it.top;
			if (translate(it, { tx: oc.width }).right <= vp.right) {
				tx = oc.width;
			} else {
				tx = 2;
			}
		}

		for (let i = ocs.length - 1; i > 0; i--) {
			const oc = ocs[i];
			const prevOc = ocs[i-1];
			if (translate(it, { tx, ty }).overlaps(oc)) {
				tx -= prevOc.width + 2;
				if (translate(it, { tx, ty }).left < vp.left) {
					tx = 0;
					if (translate(it, { tx, ty}).overlaps(oc)) {
						ty = -12 - (translate(it, { tx, ty}).bottom - oc.topFirst + 2);
					}
					break
				}
			}
		}

		function overlaps(a, b) {
			function range(low, high) {
				return {
					contains: num => low <= num && num <= high,
				};
			}

			function over(a, b) {
				const xRange = range(a.left, a.right);
				const yRange = range(a.top, a.bottom);
				const ox = xRange.contains(b.left) || xRange.contains(b.right);
				const oy = yRange.contains(b.top) || yRange.contains(b.bottom);
				return ox && oy;
			}

			return over(a, b) || over(b, a);
		}

		function dims(item) {
			return { 
				...item,
				width: item.right - item.left,
				height: item.bottom - item.top,
				overlaps(item2) { return overlaps(this, item2); },
			};
		}

		function translate({ left, top, right, bottom , ...rest}, { tx = 0, ty = 0 }) {
			return {
				left: left + tx,
				top: top + ty,
				right: right + tx,
				bottom: bottom + ty,
				...rest,
			};
		}

		return { x: tx, y: ty };
	},
	normalizeChronos(scale, chronos) {
		chronos.push(chronos.at(-1));
		const minPrice = Math.min(...chronos.map(s => s.price));
		const maxPrice = Math.max(...chronos.map(s => s.price));
		const diff = maxPrice - minPrice;
		const normalizedChronos = chronos.map(chrono => ({ price: chrono.price, date: chrono.date }));
		if (normalizedChronos.length == 1) {
			normalizedChronos.push(normalizedChronos[0]);
		}

		for (const [index, chrono] of Object.entries(normalizedChronos)) {
			const prevChrono = normalizedChronos[index > 0 ? index - 1 : 0];
			chrono.chartPrice = Math.round(normalize(minPrice, maxPrice, scale.priceMargin, scale.price - scale.priceMargin, chrono.price));
			chrono.chartDate = Math.round(normalize(0, normalizedChronos.length - 1, 0, scale.date, index));
			if (prevChrono.chartPrice != chrono.chartPrice) {
				prevChrono.priceChanged = true;
				chrono.priceChanged = true;
			}
			normalizedChronos[0].priceChanged = true;
			normalizedChronos.at(-1).priceChanged = true;
		}

		function normalize(min, max, newMin, newMax, value) {
			const diff = max - min;
			const newDiff = newMax - newMin;
			if (diff == 0) {
				return newDiff / 2;
			}

			return (value - min) * newDiff / diff + newMin;
		}

		return normalizedChronos;
	},
	calcChronosPoints(scale, chronos) {
		const chronosPoints = [{ x: 0, y: scale.price - chronos[0].chartPrice }];
		let nextOffset = 0;
		for (let i = 0; i < chronos.length; i++) {
			const s = chronos[i];
			const next = chronos[i+1];
			let offset = next && s.chartPrice != next?.chartPrice
				? (next?.chartDate - s.chartDate)
				: 0;
			if (next && s.chartPrice > next.chartPrice) {
				offset -= 2;
			}
			chronosPoints.push({ x: s.chartDate + offset + nextOffset, y: scale.price - s.chartPrice });

			if (next && s.chartPrice < next.chartPrice) {
				nextOffset = 2;
			} else {
				nextOffset = 0;
			}
		}
		return chronosPoints;
	}
};

module.exports = fn;
